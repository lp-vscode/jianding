use std::{collections::HashSet, time::Duration};

use encoding_rs::GB18030;
use futures::future::join_all;
use reqwest::{header::REFERER, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    symbol: String,
    code: String,
    name: String,
    price: Option<f64>,
    previous_close: Option<f64>,
    change: Option<f64>,
    change_pct: Option<f64>,
    open: Option<f64>,
    high: Option<f64>,
    low: Option<f64>,
    volume: Option<f64>,
    amount: Option<f64>,
    updated_at: Option<String>,
    nav_date: Option<String>,
    state: &'static str,
    source: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    symbol: String,
    code: String,
    name: String,
    kind: String,
    market: String,
    type_label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    label: String,
    value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    open: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    high: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    low: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    volume: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexQuote {
    symbol: String,
    name: String,
    price: f64,
    change: f64,
    change_pct: f64,
}

#[derive(Debug, Deserialize)]
struct FundResponse {
    #[serde(rename = "Data")]
    data: Option<FundData>,
    #[serde(rename = "ErrCode")]
    err_code: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct FundData {
    #[serde(rename = "LSJZList")]
    list: Vec<FundHistoryRow>,
}

#[derive(Clone, Debug, Deserialize)]
struct FundHistoryRow {
    #[serde(rename = "FSRQ")]
    date: String,
    #[serde(rename = "DWJZ")]
    nav: String,
    #[serde(rename = "JZZZL")]
    change_pct: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("无法初始化行情客户端: {error}"))
}

fn normalize_symbol(symbol: &str) -> Option<String> {
    let symbol = symbol.trim().to_ascii_lowercase();
    if symbol.len() < 8 {
        return None;
    }
    let market = &symbol[..2];
    let code = &symbol[2..];
    if !matches!(market, "sh" | "sz" | "jj")
        || code.len() != 6
        || !code.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some(symbol)
}

fn parse_number(value: &str) -> Option<f64> {
    let value = value.trim();
    if value.is_empty() || value == "--" {
        return None;
    }
    value.parse().ok()
}

fn tencent_timestamp(value: &str) -> Option<String> {
    if value.len() < 14 || !value[..14].bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(format!(
        "{}-{}-{}T{}:{}:{}",
        &value[0..4],
        &value[4..6],
        &value[6..8],
        &value[8..10],
        &value[10..12],
        &value[12..14]
    ))
}

fn quote_body_fields(text: &str) -> Vec<(&str, Vec<&str>)> {
    text.split(';')
        .filter_map(|segment| {
            let (name, raw) = segment.trim().split_once('=')?;
            let symbol = name.trim().strip_prefix("v_")?;
            let fields = raw.trim().trim_matches('"').split('~').collect::<Vec<_>>();
            Some((symbol, fields))
        })
        .collect()
}

fn parse_tencent_quotes(text: &str) -> Vec<Quote> {
    quote_body_fields(text)
        .into_iter()
        .filter_map(|(symbol, fields)| {
            if !(symbol.starts_with("sh") || symbol.starts_with("sz")) || fields.len() < 35 {
                return None;
            }
            let amount = fields
                .get(35)
                .and_then(|value| value.split('/').nth(2))
                .and_then(parse_number)
                .or_else(|| {
                    fields
                        .get(37)
                        .and_then(|value| parse_number(value).map(|v| v * 10_000.0))
                });
            let volume = fields
                .get(36)
                .and_then(|value| parse_number(value).map(|v| v * 100.0));
            Some(Quote {
                symbol: symbol.to_string(),
                code: fields.get(2)?.to_string(),
                name: fields.get(1)?.to_string(),
                price: fields.get(3).and_then(|value| parse_number(value)),
                previous_close: fields.get(4).and_then(|value| parse_number(value)),
                change: fields.get(31).and_then(|value| parse_number(value)),
                change_pct: fields.get(32).and_then(|value| parse_number(value)),
                open: fields.get(5).and_then(|value| parse_number(value)),
                high: fields.get(33).and_then(|value| parse_number(value)),
                low: fields.get(34).and_then(|value| parse_number(value)),
                volume,
                amount,
                updated_at: fields.get(30).and_then(|value| tencent_timestamp(value)),
                nav_date: None,
                state: "live",
                source: "腾讯行情",
            })
        })
        .collect()
}

fn parse_search_payload(payload: &str) -> Vec<SearchResult> {
    let Some(first_quote) = payload.find('"') else {
        return Vec::new();
    };
    let Some(last_quote) = payload.rfind('"') else {
        return Vec::new();
    };
    if last_quote <= first_quote {
        return Vec::new();
    }
    let escaped = &payload[first_quote + 1..last_quote];
    let decoded = serde_json::from_str::<String>(&format!("\"{escaped}\""))
        .unwrap_or_else(|_| escaped.to_string());
    let mut seen = HashSet::new();

    decoded
        .split('^')
        .filter_map(|record| {
            let fields = record.split('~').collect::<Vec<_>>();
            if fields.len() < 5 {
                return None;
            }
            let (market, code, name, raw_type) = (fields[0], fields[1], fields[2], fields[4]);
            if !matches!(market, "sh" | "sz" | "jj")
                || code.len() != 6
                || !code.bytes().all(|byte| byte.is_ascii_digit())
            {
                return None;
            }
            let is_fund = market == "jj" || raw_type.contains("ETF") || raw_type.contains("LOF");
            let is_stock = raw_type.contains("GP");
            if !is_fund && !is_stock {
                return None;
            }
            let symbol = format!("{market}{code}");
            if !seen.insert(symbol.clone()) {
                return None;
            }
            let kind = if is_fund { "fund" } else { "stock" };
            let type_label = if market == "jj" {
                "场外基金"
            } else if raw_type.contains("ETF") {
                "ETF"
            } else if raw_type.contains("LOF") {
                "LOF"
            } else {
                "A股"
            };
            Some(SearchResult {
                symbol,
                code: code.to_string(),
                name: name.to_string(),
                kind: kind.to_string(),
                market: market.to_string(),
                type_label: type_label.to_string(),
            })
        })
        .collect()
}

async fn fetch_fund_history(code: &str, count: usize) -> Result<Vec<FundHistoryRow>, String> {
    let response = client()?
        .get("https://api.fund.eastmoney.com/f10/lsjz")
        .query(&[
            ("fundCode", code),
            ("pageIndex", "1"),
            ("pageSize", &count.to_string()),
        ])
        .header(REFERER, "https://fundf10.eastmoney.com/")
        .send()
        .await
        .map_err(|error| format!("基金净值请求失败: {error}"))?;
    let body = response
        .json::<FundResponse>()
        .await
        .map_err(|error| format!("基金净值响应无法解析: {error}"))?;
    if body.err_code.unwrap_or_default() != 0 {
        return Err("基金净值接口返回错误".to_string());
    }
    body.data
        .map(|data| data.list)
        .filter(|list| !list.is_empty())
        .ok_or_else(|| "基金净值列表为空".to_string())
}

async fn fetch_fund_name(code: &str) -> Option<String> {
    search_assets_impl(code).await.ok().and_then(|results| {
        results
            .into_iter()
            .find(|item| item.code == code && item.market == "jj")
            .map(|item| item.name)
    })
}

async fn fetch_fund_quote(symbol: String) -> Result<Quote, String> {
    let code = symbol[2..].to_string();
    let rows = fetch_fund_history(&code, 2).await?;
    let latest = rows.first().ok_or_else(|| "基金最新净值缺失".to_string())?;
    let price = parse_number(&latest.nav);
    let previous_close = rows.get(1).and_then(|row| parse_number(&row.nav));
    let change = match (price, previous_close) {
        (Some(current), Some(previous)) => Some(current - previous),
        _ => None,
    };
    let change_pct = parse_number(&latest.change_pct).or_else(|| match (price, previous_close) {
        (Some(current), Some(previous)) if previous > 0.0 => {
            Some((current - previous) / previous * 100.0)
        }
        _ => None,
    });
    let name = fetch_fund_name(&code)
        .await
        .unwrap_or_else(|| format!("基金 {code}"));
    Ok(Quote {
        code,
        symbol,
        name,
        price,
        previous_close,
        change,
        change_pct,
        open: None,
        high: None,
        low: None,
        volume: None,
        amount: None,
        updated_at: Some(format!("{}T15:00:00", latest.date)),
        nav_date: Some(latest.date.clone()),
        state: "nav",
        source: "天天基金净值",
    })
}

async fn fetch_stock_quotes(symbols: &[String]) -> Result<Vec<Quote>, String> {
    if symbols.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!("https://qt.gtimg.cn/q={}", symbols.join(","));
    let bytes = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("股票行情请求失败: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("股票行情读取失败: {error}"))?;
    let text = GB18030.decode(&bytes).0;
    let quotes = parse_tencent_quotes(&text);
    if quotes.is_empty() {
        Err("股票行情响应为空".to_string())
    } else {
        Ok(quotes)
    }
}

#[tauri::command]
pub async fn fetch_quotes(symbols: Vec<String>) -> Result<Vec<Quote>, String> {
    let mut seen = HashSet::new();
    let requested = symbols
        .iter()
        .filter_map(|symbol| normalize_symbol(symbol))
        .filter(|symbol| seen.insert(symbol.clone()))
        .collect::<Vec<_>>();
    let (funds, markets): (Vec<_>, Vec<_>) = requested
        .iter()
        .cloned()
        .partition(|symbol| symbol.starts_with("jj"));

    let mut quotes = fetch_stock_quotes(&markets).await.unwrap_or_default();
    let fund_quotes = join_all(funds.into_iter().map(fetch_fund_quote)).await;
    quotes.extend(fund_quotes.into_iter().flatten());

    quotes.sort_by_key(|quote| {
        requested
            .iter()
            .position(|symbol| symbol == &quote.symbol)
            .unwrap_or(usize::MAX)
    });
    Ok(quotes)
}

async fn search_assets_impl(query: &str) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![
            ("sh600519", "600519", "贵州茅台", "stock", "sh", "A股"),
            ("sz300750", "300750", "宁德时代", "stock", "sz", "A股"),
            (
                "sh510300",
                "510300",
                "沪深300ETF华泰柏瑞",
                "fund",
                "sh",
                "ETF",
            ),
            (
                "jj012414",
                "012414",
                "招商中证白酒指数C",
                "fund",
                "jj",
                "场外基金",
            ),
            (
                "sz161725",
                "161725",
                "招商中证白酒指数(LOF)A",
                "fund",
                "sz",
                "LOF",
            ),
            ("sh601318", "601318", "中国平安", "stock", "sh", "A股"),
            ("sz000858", "000858", "五粮液", "stock", "sz", "A股"),
            ("sh588000", "588000", "科创50ETF华夏", "fund", "sh", "ETF"),
        ]
        .into_iter()
        .map(
            |(symbol, code, name, kind, market, type_label)| SearchResult {
                symbol: symbol.to_string(),
                code: code.to_string(),
                name: name.to_string(),
                kind: kind.to_string(),
                market: market.to_string(),
                type_label: type_label.to_string(),
            },
        )
        .collect());
    }

    let bytes = client()?
        .get("https://smartbox.gtimg.cn/s3/")
        .query(&[("v", "2"), ("q", query.trim()), ("t", "all"), ("c", "1")])
        .send()
        .await
        .map_err(|error| format!("标的搜索失败: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("标的搜索读取失败: {error}"))?;
    let text = GB18030.decode(&bytes).0;
    Ok(parse_search_payload(&text).into_iter().take(10).collect())
}

#[tauri::command]
pub async fn search_assets(query: String) -> Result<Vec<SearchResult>, String> {
    search_assets_impl(&query).await
}

fn parse_minute_points(payload: &Value, symbol: &str) -> Vec<TrendPoint> {
    payload["data"][symbol]["data"]["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let text = entry.as_str()?;
            let fields = text.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 2 {
                return None;
            }
            let time = fields[0];
            let label = if time.len() == 4 {
                format!("{}:{}", &time[..2], &time[2..])
            } else {
                time.to_string()
            };
            Some(TrendPoint {
                label,
                value: parse_number(fields[1])?,
                open: None,
                high: None,
                low: None,
                volume: fields.get(2).and_then(|value| parse_number(value)),
            })
        })
        .collect()
}

fn parse_kline_points(
    payload: &Value,
    symbol: &str,
    period: &str,
    full_date: bool,
) -> Vec<TrendPoint> {
    let object = &payload["data"][symbol];
    let key = format!("qfq{period}");
    let rows = object
        .get(&key)
        .or_else(|| object.get(period))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    rows.iter()
        .filter_map(|row| {
            let values = row.as_array()?;
            let date = values.first()?.as_str()?;
            let open = values
                .get(1)
                .and_then(|value| parse_number(value.as_str()?));
            let close = values
                .get(2)
                .and_then(|value| parse_number(value.as_str()?));
            let high = values
                .get(3)
                .and_then(|value| parse_number(value.as_str()?));
            let low = values
                .get(4)
                .and_then(|value| parse_number(value.as_str()?));
            let volume = values
                .get(5)
                .and_then(|value| parse_number(value.as_str()?));
            Some(TrendPoint {
                label: if full_date {
                    date.to_string()
                } else {
                    date.get(5..).unwrap_or(date).to_string()
                },
                value: close?,
                open,
                high,
                low,
                volume,
            })
        })
        .collect()
}

async fn fetch_market_trend(symbol: &str, range: &str) -> Result<Vec<TrendPoint>, String> {
    if range == "intraday" {
        let payload = client()?
            .get("https://web.ifzq.gtimg.cn/appstock/app/minute/query")
            .query(&[("code", symbol)])
            .send()
            .await
            .map_err(|error| format!("分时走势请求失败: {error}"))?
            .json::<Value>()
            .await
            .map_err(|error| format!("分时走势解析失败: {error}"))?;
        return Ok(parse_minute_points(&payload, symbol));
    }
    let (period, count) = match range {
        "5d" => ("day", 5),
        "1m" => ("day", 22),
        "3m" => ("day", 66),
        "1y" => ("day", 250),
        "week" => ("week", 52),
        "month" => ("month", 36),
        _ => ("day", 120),
    };
    let parameter = format!("{symbol},{period},,,{count},qfq");
    let payload = client()?
        .get("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get")
        .query(&[("param", parameter)])
        .send()
        .await
        .map_err(|error| format!("K线走势请求失败: {error}"))?
        .json::<Value>()
        .await
        .map_err(|error| format!("K线走势解析失败: {error}"))?;
    Ok(parse_kline_points(&payload, symbol, period, range == "1y"))
}

fn aggregate_fund_points(rows: &[FundHistoryRow], range: &str) -> Vec<TrendPoint> {
    let mut ordered = rows.to_vec();
    ordered.reverse();
    let stride = match range {
        "week" => 5,
        "month" => 21,
        _ => 1,
    };
    let mut points = ordered
        .iter()
        .enumerate()
        .filter(|(index, _)| *index % stride == 0 || *index == ordered.len().saturating_sub(1))
        .filter_map(|(_, row)| {
            Some(TrendPoint {
                label: row.date.get(5..).unwrap_or(&row.date).to_string(),
                value: parse_number(&row.nav)?,
                open: None,
                high: None,
                low: None,
                volume: None,
            })
        })
        .collect::<Vec<_>>();
    if range == "intraday" {
        points = points.into_iter().rev().take(20).collect::<Vec<_>>();
        points.reverse();
    }
    points
}

async fn fetch_fund_trend(symbol: &str, range: &str) -> Result<Vec<TrendPoint>, String> {
    let count = match range {
        "5d" => 8,
        "1m" => 32,
        "3m" => 100,
        "1y" => 260,
        "week" => 520,
        "month" => 760,
        "intraday" => 20,
        _ => 120,
    };
    let rows = fetch_fund_history(&symbol[2..], count).await?;
    Ok(aggregate_fund_points(&rows, range))
}

#[tauri::command]
pub async fn fetch_trend(symbol: String, range: String) -> Result<Vec<TrendPoint>, String> {
    let symbol = normalize_symbol(&symbol).ok_or_else(|| "标的不合法".to_string())?;
    if symbol.starts_with("jj") {
        fetch_fund_trend(&symbol, &range).await
    } else {
        fetch_market_trend(&symbol, &range).await
    }
}

fn parse_tencent_indices(text: &str) -> Vec<IndexQuote> {
    quote_body_fields(text)
        .into_iter()
        .filter_map(|(symbol, fields)| {
            let code = fields.get(2)?.to_string();
            let market = symbol.split_at(2).0;
            Some(IndexQuote {
                symbol: format!("{market}{code}"),
                name: fields.get(1)?.to_string(),
                price: parse_number(fields.get(3)?)?,
                change: parse_number(fields.get(4)?)?,
                change_pct: parse_number(fields.get(5)?)?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn fetch_indices() -> Result<Vec<IndexQuote>, String> {
    let bytes = client()?
        .get("https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_sh000300,s_sh000905,s_sh000688")
        .send()
        .await
        .map_err(|error| format!("指数行情请求失败: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("指数行情读取失败: {error}"))?;
    let text = GB18030.decode(&bytes).0;
    Ok(parse_tencent_indices(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tencent_quote() {
        let fixture = r#"v_sh600519="1~贵州茅台~600519~1309.69~1331.88~1331.88~33514~16345~17169~1309.59~2~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~20261021161453~-22.19~-1.67~1331.98~1302.36~1309.69/33514/4403823070~33514~440382";"#;
        let quotes = parse_tencent_quotes(fixture);
        assert_eq!(quotes.len(), 1);
        assert_eq!(quotes[0].name, "贵州茅台");
        assert_eq!(quotes[0].price, Some(1309.69));
        assert_eq!(quotes[0].change_pct, Some(-1.67));
        assert_eq!(quotes[0].amount, Some(4_403_823_070.0));
        assert_eq!(quotes[0].updated_at.as_deref(), Some("2026-10-21T16:14:53"));
    }

    #[test]
    fn decodes_search_results_and_filters_markets() {
        let fixture = r#"v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A^hk~03750~\u8d35\u5dde\u8305\u53f0~gzmt~GP^jj~012414~\u62db\u5546\u4e2d\u8bc1\u767d\u9152\u6307\u6570C~zszzbjzsc~KJ";"#;
        let results = parse_search_payload(fixture);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].symbol, "sh600519");
        assert_eq!(results[0].name, "贵州茅台");
        assert_eq!(results[1].kind, "fund");
        assert_eq!(results[1].type_label, "场外基金");
    }

    #[test]
    fn parses_minute_and_kline_points() {
        let minute = serde_json::json!({
            "data": {
                "sh600519": {
                    "data": { "data": ["0930 1331.88 516 68725008.28", "0931 1323.36 1237 164351870"] }
                }
            }
        });
        let minute_points = parse_minute_points(&minute, "sh600519");
        assert_eq!(minute_points.len(), 2);
        assert_eq!(minute_points[1].label, "09:31");
        assert_eq!(minute_points[1].value, 1323.36);

        let kline = serde_json::json!({
            "data": {
                "sh600519": {
                    "qfqday": [["2026-10-20", "1321.01", "1331.88", "1335.00", "1316.14", "34136"]]
                }
            }
        });
        let day_points = parse_kline_points(&kline, "sh600519", "day", false);
        assert_eq!(day_points.len(), 1);
        assert_eq!(day_points[0].label, "10-20");
        assert_eq!(day_points[0].open, Some(1321.01));
        assert_eq!(day_points[0].value, 1331.88);
    }

    #[test]
    fn aggregates_fund_history_oldest_first() {
        let rows = vec![
            FundHistoryRow {
                date: "2026-10-21".into(),
                nav: "0.5239".into(),
                change_pct: "-2.58".into(),
            },
            FundHistoryRow {
                date: "2026-10-20".into(),
                nav: "0.5378".into(),
                change_pct: "-0.63".into(),
            },
        ];
        let points = aggregate_fund_points(&rows, "day");
        assert_eq!(points[0].label, "10-20");
        assert_eq!(points[1].value, 0.5239);
    }

    #[tokio::test]
    #[ignore = "uses public market data endpoints"]
    async fn public_market_sources_smoke_test() {
        let quotes = fetch_quotes(vec![
            "sh600519".into(),
            "sh510300".into(),
            "jj012414".into(),
        ])
        .await
        .expect("quotes should be available");
        assert_eq!(quotes.len(), 3);
        assert!(quotes
            .iter()
            .any(|quote| quote.symbol == "sh600519" && quote.price.unwrap_or_default() > 0.0));
        assert!(quotes
            .iter()
            .any(|quote| quote.symbol == "jj012414" && quote.state == "nav"));

        let indices = fetch_indices().await.expect("indices should be available");
        assert_eq!(indices.len(), 6);

        let results = search_assets_impl("贵州茅台")
            .await
            .expect("search should be available");
        assert!(results.iter().any(|item| item.symbol == "sh600519"));

        let trend = fetch_market_trend("sh600519", "intraday")
            .await
            .expect("intraday trend should be available");
        assert!(!trend.is_empty());
    }
}
