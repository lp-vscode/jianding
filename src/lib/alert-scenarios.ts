import type { AlertTemplateKey } from "../types";

export interface AlertScenario {
  key: AlertTemplateKey;
  label: string;
  description: string;
  requiresHolding?: boolean;
}

export const ALERT_SCENARIOS: AlertScenario[] = [
  {
    key: "breakout",
    label: "突破确认",
    description: "价格较当前上破 3%",
  },
  {
    key: "volume",
    label: "放量启动",
    description: "上涨 3% 且成交额达到 10 亿",
  },
  {
    key: "pullback",
    label: "回调观察",
    description: "价格较当前回落 3%",
  },
  {
    key: "volatility",
    label: "双向异动",
    description: "任一方向涨跌达到 5%",
  },
  {
    key: "goldenCross",
    label: "均线金叉",
    description: "SMA 5 上穿 SMA 20",
  },
  {
    key: "rsiOversold",
    label: "RSI 超卖",
    description: "RSI 14 低于 30",
  },
  {
    key: "takeProfit",
    label: "持仓止盈",
    description: "持仓盈利达到 10%",
    requiresHolding: true,
  },
  {
    key: "stopLoss",
    label: "持仓止损",
    description: "持仓亏损达到 5%",
    requiresHolding: true,
  },
];
