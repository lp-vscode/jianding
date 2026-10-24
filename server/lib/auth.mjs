import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
}

export function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const candidate = scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function createToken(userId, secret) {
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    }),
  );
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.sub || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now() / 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export function validateCredentials(username, password) {
  if (typeof username !== "string" || !/^[\w\u4e00-\u9fff.-]{3,32}$/u.test(username.trim())) {
    return "用户名需为 3-32 位字母、数字、中文、点、横线或下划线";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return "密码长度需为 8-128 位";
  }
  return null;
}
