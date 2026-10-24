import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiandingBackend } from "../app.mjs";

function quote(price = 1300) {
  return {
    symbol: "sh600519",
    code: "600519",
    name: "贵州茅台",
    price,
    previousClose: 1280,
    change: price - 1280,
    changePct: ((price - 1280) / 1280) * 100,
    open: 1290,
    high: price,
    low: 1280,
    volume: 3_000_000,
    amount: 4_000_000_000,
    updatedAt: "2026-10-24T06:30:00",
    navDate: null,
    state: "live",
    source: "测试行情",
  };
}

async function withBackend(run) {
  const directory = await mkdtemp(join(tmpdir(), "jianding-backend-"));
  let price = 1300;
  const webhookCalls = [];
  const backend = await createJiandingBackend({
    dataDirectory: directory,
    refreshMs: 60_000,
    quoteProvider: async () => [quote(price)],
    trendProvider: async () => [],
    webhookFetch: async (url, options) => {
      webhookCalls.push({ url, options });
      return new Response("ok", { status: 200 });
    },
  });
  const address = await backend.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await run({
      base,
      backend,
      webhookCalls,
      setPrice(value) {
        price = value;
      },
    });
  } finally {
    await backend.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function api(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

test("registers users and resolves state revision conflicts", async () => {
  await withBackend(async ({ base }) => {
    const registered = await api(base, "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: "local-user", password: "strong-password" }),
    });
    assert.equal(registered.response.status, 201);
    const token = registered.body.token;
    const headers = { authorization: `Bearer ${token}` };

    const first = await api(base, "/api/state", {
      method: "PUT",
      headers,
      body: JSON.stringify({ expectedRevision: 0, state: { watchlist: ["sh600519"] } }),
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.revision, 1);

    const conflict = await api(base, "/api/state", {
      method: "PUT",
      headers,
      body: JSON.stringify({ expectedRevision: 0, state: { watchlist: [] } }),
    });
    assert.equal(conflict.response.status, 409);

    const synced = await api(base, "/api/state", { headers });
    assert.deepEqual(synced.body.state.watchlist, ["sh600519"]);
    assert.equal(synced.body.revision, 1);
  });
});

test("creates and lists strategy templates", async () => {
  await withBackend(async ({ base }) => {
    const registered = await api(base, "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: "template-user", password: "strong-password" }),
    });
    const headers = { authorization: `Bearer ${registered.body.token}` };
    const created = await api(base, "/api/templates", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "测试金叉",
        description: "SMA 5/20",
        category: "技术指标",
        public: true,
        strategy: {
          logic: "all",
          conditions: [{ type: "smaGolden", threshold: 1, period: 5, secondaryPeriod: 20 }],
        },
      }),
    });
    assert.equal(created.response.status, 201);
    const list = await api(base, "/api/templates?q=金叉");
    assert.ok(list.body.templates.some((template) => template.name === "测试金叉"));
  });
});

test("evaluates server-side alerts and delivers webhooks", async () => {
  await withBackend(async ({ base, backend, webhookCalls }) => {
    const registered = await api(base, "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: "alert-user", password: "strong-password" }),
    });
    const headers = { authorization: `Bearer ${registered.body.token}` };
    await api(base, "/api/state", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        state: {
          watchlist: ["sh600519"],
          alerts: [
            {
              id: "alert_1",
              symbol: "sh600519",
              type: "priceAbove",
              threshold: 1290,
              conditions: [{ type: "priceAbove", threshold: 1290 }],
              logic: "all",
              schedule: "any",
              enabled: true,
              createdAt: 1,
              lastTriggeredAt: 0,
            },
          ],
          holdings: [],
        },
      }),
    });
    await api(base, "/api/webhooks", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        webhooks: [{ name: "本地测试", url: "http://127.0.0.1:9999/hook", secret: "hook-secret" }],
      }),
    });
    const result = await backend.pollOnce(Date.now());
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].symbol, "sh600519");
    assert.equal(webhookCalls.length, 1);
    assert.ok(webhookCalls[0].options.headers["x-jianding-signature"]);

    const events = await api(base, "/api/events", { headers });
    assert.equal(events.body.events.length, 1);
    assert.match(events.body.events[0].message, /贵州茅台/);
  });
});

test("opens an authenticated SSE stream", async () => {
  await withBackend(async ({ base }) => {
    const registered = await api(base, "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: "stream-user", password: "strong-password" }),
    });
    const token = encodeURIComponent(registered.body.token);
    const controller = new AbortController();
    const response = await fetch(`${base}/api/stream?symbols=sh600519&token=${token}`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /event: hello/);
    controller.abort();
  });
});
