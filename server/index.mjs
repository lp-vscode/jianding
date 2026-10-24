import { createJiandingBackend } from "./app.mjs";

const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || "127.0.0.1";
const backend = await createJiandingBackend();
const address = await backend.listen(port, host);
console.log(`简盯本地后端已启动: http://${host}:${typeof address === "object" ? address.port : port}`);
console.log(`数据目录: ${backend.database.filePath}`);

async function shutdown() {
  await backend.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
