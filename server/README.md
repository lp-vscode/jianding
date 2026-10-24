# 简盯本地 Node 后端

零第三方运行时依赖，默认监听 `127.0.0.1:8788`。数据保存在 `server/data/jianding-backend.json`，通过临时文件替换写入，文件权限为 `0600`。

## 启动

```bash
npm run server
```

可选环境变量见 [`.env.example`](./.env.example)。本服务不读取 `.env` 文件，请通过 shell 或进程管理器注入。

## 能力

- `POST /api/auth/register`：注册本地账号，返回 Bearer Token。
- `POST /api/auth/login`：登录并签发 30 天 Token。
- `GET /api/auth/me`：读取当前账号。
- `GET/PUT /api/state`：账号状态同步。PUT 支持 `expectedRevision` 或 `If-Match`，冲突返回 `409`。
- `GET /api/events`：读取服务端触发记录。
- `GET/PUT /api/webhooks`：管理最多 10 个 Webhook，触发时发送 `alert.triggered` JSON。
- `GET /api/templates`：读取公开策略模板。
- `POST /api/templates`：创建模板。
- `GET/PUT/DELETE /api/templates/:id`：读取、编辑或删除模板。
- `GET /api/stream?symbols=sh600519,sz300750&token=...`：SSE 行情与提醒流。
- `GET /api/health`：服务状态。

## 服务端提醒

服务每 `MARKET_REFRESH_MS` 毫秒拉取一次行情，并检查已同步状态中的 `alerts`。支持价格、涨跌幅、成交额、RSI、SMA 金叉/死叉、成交量异动、跳空和持仓盈亏条件，也支持 `any/all` 组合及监控时段。

同一规则 30 分钟冷却。触发的记录保存在服务端并推送到该账号的 SSE 连接；配置了 Webhook 时会同时发送带 `X-Jianding-Signature` 的 POST 请求，签名内容为 HMAC-SHA256 请求体。

## 安全边界

- 默认仅监听回环地址。
- 密码使用 `scrypt` 加盐保存。
- Token 使用服务端生成密钥进行 HMAC 签名。
- CORS 默认只允许本地 Vite 和 GitHub Pages 来源，可通过 `JIANDING_ALLOWED_ORIGINS` 调整。
- 本地账号不是生产级身份系统，不包含邮箱验证、找回密码、速率限制、TLS 和账号注销。

## 测试

```bash
npm run test:server
```
