import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  createToken,
  hashPassword,
  readBearerToken,
  validateCredentials,
  verifyPassword,
  verifyToken,
} from "./lib/auth.mjs";
import { alertMessage, evaluateRule, ruleNeedsTrend } from "./lib/alerts.mjs";
import { fetchDailyTrend, fetchLiveQuotes } from "./lib/market.mjs";
import { createDatabase } from "./lib/storage.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALERT_COOLDOWN = 30 * 60 * 1000;

const builtinTemplates = [
  {
    id: "builtin-volume-breakout",
    name: "放量突破",
    description: "价格突破当前上沿，同时成交额达到 10 亿。",
    category: "趋势",
    author: "简盯",
    public: true,
    builtin: true,
    strategy: {
      logic: "all",
      conditions: [
        { type: "priceAbove", threshold: 0 },
        { type: "amountAbove", threshold: 10 },
      ],
    },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "builtin-sma-golden",
    name: "均线金叉",
    description: "SMA 5 上穿 SMA 20，适合捕捉中短期趋势切换。",
    category: "技术指标",
    author: "简盯",
    public: true,
    builtin: true,
    strategy: {
      logic: "all",
      conditions: [{ type: "smaGolden", threshold: 1, period: 5, secondaryPeriod: 20 }],
    },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "builtin-position-stop",
    name: "持仓止损",
    description: "持仓浮亏达到 10% 时触发止损提醒。",
    category: "持仓",
    author: "简盯",
    public: true,
    builtin: true,
    strategy: {
      logic: "all",
      conditions: [{ type: "pnlBelow", threshold: 10 }],
    },
    createdAt: 0,
    updatedAt: 0,
  },
];

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("请求体超过 2 MiB"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求体不是有效 JSON"), { status: 400 });
  }
}

function cleanUsername(username) {
  return String(username ?? "").trim();
}

function webhookSafeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function createJiandingBackend(options = {}) {
  const dataDirectory = options.dataDirectory ?? process.env.JIANDING_DATA_DIR ?? `${process.cwd()}/server/data`;
  const quoteProvider = options.quoteProvider ?? fetchLiveQuotes;
  const trendProvider = options.trendProvider ?? fetchDailyTrend;
  const webhookFetch = options.webhookFetch ?? fetch;
  const refreshMs = options.refreshMs ?? Number(process.env.MARKET_REFRESH_MS || 15_000);
  const db = createDatabase(dataDirectory);
  await db.load();
  if (!db.data.templates.some((template) => template.builtin)) {
    db.data.templates.push(...builtinTemplates);
    await db.save();
  }

  const streamClients = new Set();
  const trendCache = new Map();
  const secret = db.data.meta.secret;
  let timer;
  let pollInFlight = false;

  function corsHeaders(origin) {
    const allowed = (process.env.JIANDING_ALLOWED_ORIGINS ??
      "http://localhost:1420,http://127.0.0.1:1420,https://lp-vscode.github.io")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!origin || allowed.includes(origin)) {
      return {
        "access-control-allow-origin": origin || "*",
        "access-control-allow-headers": "authorization,content-type,if-match",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        vary: "origin",
      };
    }
    return null;
  }

  function applyCors(req, res) {
    const headers = corsHeaders(req.headers.origin);
    if (!headers) return false;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    return true;
  }

  function publicUser(user) {
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  }

  function authenticate(req, url) {
    const token = readBearerToken(req) ?? url.searchParams.get("token");
    const payload = verifyToken(token, secret);
    if (!payload) return null;
    return db.data.users.find((user) => user.id === payload.sub) ?? null;
  }

  function requireUser(req, res, url) {
    const user = authenticate(req, url);
    if (!user) {
      json(res, 401, { error: "需要有效的登录令牌" });
      return null;
    }
    return user;
  }

  function sendStream(client, event, data) {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(event, data, symbol, userId = null) {
    for (const client of streamClients) {
      if (userId && client.userId !== userId) continue;
      if (symbol && client.symbols.size && !client.symbols.has(symbol)) continue;
      sendStream(client, event, data);
    }
  }

  async function signWebhook(secretValue, body) {
    if (!secretValue) return null;
    return createHmac("sha256", secretValue).update(body).digest("hex");
  }

  async function deliverWebhooks(userId, event) {
    const hooks = (db.data.webhooks[userId] ?? []).filter((hook) => hook.enabled !== false);
    if (!hooks.length) return;
    const body = JSON.stringify({ type: "alert.triggered", event });
    await Promise.allSettled(
      hooks.map(async (hook) => {
        const signature = await signWebhook(hook.secret, body);
        await webhookFetch(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "JiandingLocalBackend/1.0",
            ...(signature ? { "x-jianding-signature": signature } : {}),
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
      }),
    );
  }

  function trendFor(symbol) {
    return trendCache.get(symbol)?.points ?? [];
  }

  async function pollOnce(now = Date.now()) {
    if (pollInFlight) return { quotes: [], events: [] };
    pollInFlight = true;
    try {
      const symbols = new Set();
      for (const client of streamClients) {
        for (const symbol of client.symbols) symbols.add(symbol);
      }
      for (const stateRecord of Object.values(db.data.userStates)) {
        const state = stateRecord?.state;
        for (const symbol of state?.watchlist ?? []) symbols.add(symbol);
        for (const rule of state?.alerts ?? []) if (rule?.symbol) symbols.add(rule.symbol);
      }
      const quotes = await quoteProvider([...symbols]);
      for (const quote of quotes) broadcast("quote", quote, quote.symbol);

      const createdEvents = [];
      const triggered = [];
      for (const user of db.data.users) {
        const state = db.data.userStates[user.id]?.state;
        if (!Array.isArray(state?.alerts) || !state.alerts.length) continue;
        const technicalSymbols = new Set(
          state.alerts.filter(ruleNeedsTrend).map((rule) => rule.symbol),
        );
        await Promise.all(
          [...technicalSymbols].map(async (symbol) => {
            const cached = trendCache.get(symbol);
            if (cached && now - cached.at < 90_000) return;
            try {
              const points = await trendProvider(symbol, 250);
              trendCache.set(symbol, { at: now, points });
            } catch {
              // Keep the previous snapshot when the upstream trend request fails.
            }
          }),
        );
        const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
        for (const rule of state.alerts) {
          const runtimeKey = `${user.id}:${rule.id}`;
          const lastTriggeredAt = db.data.runtime[runtimeKey] ?? rule.lastTriggeredAt ?? 0;
          if (now - lastTriggeredAt < ALERT_COOLDOWN) continue;
          const quote = quoteMap.get(rule.symbol);
          const holding = state.holdings?.find((item) => item.symbol === rule.symbol);
          if (
            !evaluateRule(
              rule,
              quote,
              { trend: trendFor(rule.symbol), holdingCost: holding?.cost },
              new Date(now),
            )
          ) {
            continue;
          }
          const event = {
            id: `event_${randomUUID()}`,
            ruleId: rule.id,
            symbol: rule.symbol,
            name: quote.name,
            message: alertMessage(rule, quote),
            price: quote.price ?? 0,
            changePct: quote.changePct,
            amount: quote.amount,
            volume: quote.volume,
            source: quote.source,
            at: now,
            read: false,
          };
          triggered.push({ userId: user.id, runtimeKey, event });
          createdEvents.push(event);
        }
      }
      if (triggered.length) {
        await db.update((data) => {
          for (const item of triggered) {
            data.runtime[item.runtimeKey] = now;
            const userEvents = data.userEvents[item.userId] ?? [];
            userEvents.unshift(item.event);
            data.userEvents[item.userId] = userEvents.slice(0, 200);
          }
        });
        for (const item of triggered) {
          broadcast("alert", item.event, item.event.symbol, item.userId);
          void deliverWebhooks(item.userId, item.event);
        }
      }
      return { quotes, events: createdEvents };
    } finally {
      pollInFlight = false;
    }
  }

  async function route(req, res) {
    if (!applyCors(req, res)) {
      json(res, 403, { error: "来源不在允许列表" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
    const url = new URL(req.url ?? "/", origin);
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        json(res, 200, {
          ok: true,
          service: "jianding-local-backend",
          version: 1,
          uptime: process.uptime(),
          refreshMs,
          users: db.data.users.length,
          templates: db.data.templates.length,
          streamClients: streamClients.size,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/register") {
        const body = await readJson(req);
        const username = cleanUsername(body.username);
        const credentialError = validateCredentials(username, body.password);
        if (credentialError) return json(res, 400, { error: credentialError });
        if (db.data.users.some((user) => user.username === username)) {
          return json(res, 409, { error: "用户名已存在" });
        }
        const password = hashPassword(body.password);
        const user = {
          id: `user_${randomUUID()}`,
          username,
          salt: password.salt,
          passwordHash: password.hash,
          createdAt: Date.now(),
        };
        await db.update((data) => data.users.push(user));
        json(res, 201, {
          user: publicUser(user),
          token: createToken(user.id, secret),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson(req);
        const username = cleanUsername(body.username);
        const user = db.data.users.find((item) => item.username === username);
        if (!user || !verifyPassword(body.password, user)) {
          return json(res, 401, { error: "用户名或密码错误" });
        }
        json(res, 200, {
          user: publicUser(user),
          token: createToken(user.id, secret),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/me") {
        const user = requireUser(req, res, url);
        if (!user) return;
        json(res, 200, { user: publicUser(user) });
        return;
      }

      if (url.pathname === "/api/state") {
        const user = requireUser(req, res, url);
        if (!user) return;
        if (req.method === "GET") {
          const record = db.data.userStates[user.id] ?? {
            state: null,
            revision: 0,
            updatedAt: null,
          };
          return json(res, 200, record);
        }
        if (req.method === "PUT") {
          const body = await readJson(req);
          const current = db.data.userStates[user.id] ?? {
            state: null,
            revision: 0,
            updatedAt: null,
          };
          const expected = body.expectedRevision ?? req.headers["if-match"];
          if (expected != null && Number(expected) !== current.revision) {
            return json(res, 409, {
              error: "状态版本冲突，请先拉取最新状态",
              current,
            });
          }
          if (!body.state || typeof body.state !== "object") {
            return json(res, 400, { error: "state 必须是对象" });
          }
          const next = {
            state: body.state,
            revision: current.revision + 1,
            updatedAt: Date.now(),
          };
          await db.update((data) => {
            data.userStates[user.id] = next;
          });
          return json(res, 200, next);
        }
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        const user = requireUser(req, res, url);
        if (!user) return;
        json(res, 200, { events: db.data.userEvents[user.id] ?? [] });
        return;
      }

      if (url.pathname === "/api/webhooks") {
        const user = requireUser(req, res, url);
        if (!user) return;
        if (req.method === "GET") {
          json(res, 200, { webhooks: db.data.webhooks[user.id] ?? [] });
          return;
        }
        if (req.method === "PUT") {
          const body = await readJson(req);
          if (!Array.isArray(body.webhooks) || body.webhooks.length > 10) {
            return json(res, 400, { error: "webhooks 必须是最多 10 项的数组" });
          }
          const webhooks = body.webhooks.flatMap((hook) => {
            const safeUrl = webhookSafeUrl(hook?.url);
            if (!safeUrl) return [];
            return [
              {
                id: String(hook.id || `webhook_${randomUUID()}`),
                name: String(hook.name || "Webhook"),
                url: safeUrl,
                enabled: hook.enabled !== false,
                secret: typeof hook.secret === "string" ? hook.secret.slice(0, 128) : "",
              },
            ];
          });
          await db.update((data) => {
            data.webhooks[user.id] = webhooks;
          });
          return json(res, 200, { webhooks });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/templates") {
        const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
        const own = url.searchParams.get("own") === "1";
        const user = own ? authenticate(req, url) : null;
        if (own && !user) return json(res, 401, { error: "需要有效的登录令牌" });
        const templates = db.data.templates.filter(
          (template) =>
            (own ? template.ownerId === user.id : template.public || (user && template.ownerId === user.id)) &&
            (!query ||
              `${template.name} ${template.description} ${template.category}`
                .toLowerCase()
                .includes(query)),
        );
        return json(res, 200, { templates });
      }

      if (req.method === "POST" && url.pathname === "/api/templates") {
        const user = requireUser(req, res, url);
        if (!user) return;
        const body = await readJson(req);
        if (!body.name || !body.strategy || typeof body.strategy !== "object") {
          return json(res, 400, { error: "模板需要名称和 strategy" });
        }
        const template = {
          id: `template_${randomUUID()}`,
          name: String(body.name).slice(0, 60),
          description: String(body.description || "").slice(0, 300),
          category: String(body.category || "自定义").slice(0, 30),
          author: user.username,
          ownerId: user.id,
          public: body.public !== false,
          builtin: false,
          strategy: body.strategy,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await db.update((data) => data.templates.unshift(template));
        return json(res, 201, { template });
      }

      const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
      if (templateMatch) {
        const template = db.data.templates.find((item) => item.id === templateMatch[1]);
        if (!template) return json(res, 404, { error: "模板不存在" });
        if (req.method === "GET") return json(res, 200, { template });
        const user = requireUser(req, res, url);
        if (!user) return;
        if (template.builtin || template.ownerId !== user.id) {
          return json(res, 403, { error: "只能修改自己的模板" });
        }
        if (req.method === "PUT") {
          const body = await readJson(req);
          const updated = await db.update((data) => {
            const item = data.templates.find((entry) => entry.id === template.id);
            if (!item) return null;
            item.name = String(body.name ?? item.name).slice(0, 60);
            item.description = String(body.description ?? item.description).slice(0, 300);
            item.category = String(body.category ?? item.category).slice(0, 30);
            item.public = body.public ?? item.public;
            if (body.strategy && typeof body.strategy === "object") item.strategy = body.strategy;
            item.updatedAt = Date.now();
            return item;
          });
          if (!updated) return json(res, 404, { error: "模板不存在" });
          return json(res, 200, { template: updated });
        }
        if (req.method === "DELETE") {
          await db.update((data) => {
            data.templates = data.templates.filter((item) => item.id !== template.id);
          });
          return json(res, 200, { deleted: true });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/stream") {
        const user = requireUser(req, res, url);
        if (!user) return;
        const symbols = new Set(
          (url.searchParams.get("symbols") ?? "")
            .split(",")
            .map((symbol) => symbol.trim())
            .filter((symbol) => /^(sh|sz)\d{6}$/.test(symbol)),
        );
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const client = { res, userId: user.id, symbols };
        streamClients.add(client);
        sendStream(client, "hello", {
          user: publicUser(user),
          symbols: [...symbols],
          at: Date.now(),
        });
        req.on("close", () => streamClients.delete(client));
        return;
      }

      json(res, 404, { error: "接口不存在" });
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) console.error(error);
      json(res, status, { error: error?.message || "服务器内部错误" });
    }
  }

  const server = createServer(route);
  const keepAlive = setInterval(() => {
    for (const client of streamClients) {
      client.res.write(": keepalive\n\n");
    }
  }, 15_000);
  keepAlive.unref();

  return {
    server,
    database: db,
    pollOnce,
    startPolling() {
      clearInterval(timer);
      timer = setInterval(() => {
        void pollOnce().catch((error) => console.error("行情轮询失败", error));
      }, refreshMs);
      timer.unref();
    },
    async listen(port = 8788, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      this.startPolling();
      return server.address();
    },
    async close() {
      clearInterval(timer);
      clearInterval(keepAlive);
      for (const client of streamClients) client.res.end();
      streamClients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
