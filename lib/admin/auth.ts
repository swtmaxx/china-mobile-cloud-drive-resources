import type { Env } from "../env";
import { base64UrlEncode } from "../139/crypto";
import { decodeKeyBytes } from "../security/keys";
import { AdminError } from "./errors";
import {
  ADMIN_PASSWORD_KEY,
  ADMIN_SESSION_VERSION_KEY,
  incrementNumericValue,
  readNumericValue,
} from "./storage";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { equalPasswordValues, hashPassword, isAcceptablePassword, verifyPassword } from "../security/passwords";

export const ADMIN_COOKIE_NAME = "admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_FAILURE_TTL_SECONDS = 15 * 60;
const LOGIN_FAILURE_LIMIT = 5;

interface AdminSessionCookie {
  version: 1;
  sessionVersion: number;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
}

interface LoginFailureState {
  count: number;
  blockedUntil?: number;
}

function sessionKey(env: Env): string {
  if (!env.ADMIN_SESSION_KEY) {
    throw new AdminError("ADMIN_SESSION_KEY is not configured", 503, "admin_misconfigured");
  }
  try {
    decodeKeyBytes(env.ADMIN_SESSION_KEY, "ADMIN_SESSION_KEY");
  } catch (error) {
    if (error instanceof AdminError) {
      throw error;
    }
    throw new AdminError("ADMIN_SESSION_KEY is invalid", 503, "admin_misconfigured");
  }
  return env.ADMIN_SESSION_KEY;
}

function sessionFailureKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function failureKey(request: Request): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionFailureKey(request)).buffer as ArrayBuffer);
  return `admin:login-failures:${base64UrlEncode(new Uint8Array(digest)).slice(0, 32)}`;
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === ADMIN_COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function secureCookie(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true;
  }
}

export function adminCookieHeader(request: Request, value: string, maxAge = ADMIN_SESSION_TTL_SECONDS): string {
  const attributes = [
    `${ADMIN_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secureCookie(request)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function clearAdminCookie(request: Request): string {
  return adminCookieHeader(request, "", 0);
}

export async function createAdminSession(env: Env): Promise<{ value: string; session: AdminSessionCookie }> {
  const now = Date.now();
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const session: AdminSessionCookie = {
    version: 1,
    sessionVersion: await readNumericValue(env, ADMIN_SESSION_VERSION_KEY, 1) || 1,
    csrfToken: base64UrlEncode(tokenBytes),
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_SECONDS * 1000,
  };
  const value = await encryptSecret(JSON.stringify(session), sessionKey(env), "ADMIN_SESSION_KEY");
  return { value, session };
}

export async function readAdminSession(request: Request, env: Env): Promise<AdminSessionCookie | null> {
  const value = cookieValue(request);
  if (!value) {
    return null;
  }
  try {
    const plaintext = await decryptSecret(value, sessionKey(env), "ADMIN_SESSION_KEY");
    const session = JSON.parse(plaintext) as Partial<AdminSessionCookie>;
    const currentVersion = await readNumericValue(env, ADMIN_SESSION_VERSION_KEY, 1) || 1;
    if (session.version !== 1
      || session.sessionVersion !== currentVersion
      || typeof session.csrfToken !== "string"
      || session.csrfToken.length < 20
      || typeof session.issuedAt !== "number"
      || typeof session.expiresAt !== "number"
      || session.expiresAt <= Date.now()) {
      return null;
    }
    return session as AdminSessionCookie;
  } catch (error) {
    if (error instanceof AdminError) {
      throw error;
    }
    return null;
  }
}

export async function requireAdminSession(request: Request, env: Env): Promise<AdminSessionCookie> {
  const session = await readAdminSession(request, env);
  if (!session) {
    throw new AdminError("后台登录已失效，请重新登录。", 401, "admin_unauthorized");
  }
  return session;
}

export function requireCsrf(request: Request, session: AdminSessionCookie): void {
  const token = request.headers.get("X-CSRF-Token") || "";
  if (!equalPasswordValues(token, session.csrfToken)) {
    throw new AdminError("请求校验已失效，请刷新后台后重试。", 403, "csrf_invalid");
  }
}

async function readFailureState(env: Env, request: Request): Promise<{ key: string; state: LoginFailureState | null }> {
  const key = await failureKey(request);
  const stored = await env.RESOURCE_KV.get(key);
  if (!stored) {
    return { key, state: null };
  }
  try {
    return { key, state: JSON.parse(stored) as LoginFailureState };
  } catch {
    await env.RESOURCE_KV.delete(key);
    return { key, state: null };
  }
}

export async function loginRateLimit(env: Env, request: Request): Promise<number | null> {
  const { state } = await readFailureState(env, request);
  const blockedUntil = state?.blockedUntil || 0;
  if (blockedUntil > Date.now()) {
    return Math.ceil((blockedUntil - Date.now()) / 1000);
  }
  return null;
}

export async function recordLoginFailure(env: Env, request: Request): Promise<number | null> {
  const { key, state } = await readFailureState(env, request);
  const count = (state?.count || 0) + 1;
  const blockedUntil = count >= LOGIN_FAILURE_LIMIT ? Date.now() + LOGIN_FAILURE_TTL_SECONDS * 1000 : undefined;
  await env.RESOURCE_KV.put(key, JSON.stringify({ count, blockedUntil }), { expirationTtl: LOGIN_FAILURE_TTL_SECONDS });
  return blockedUntil ? LOGIN_FAILURE_TTL_SECONDS : null;
}

export async function clearLoginFailures(env: Env, request: Request): Promise<void> {
  await env.RESOURCE_KV.delete(await failureKey(request));
}

interface PasswordRecord {
  hash: string;
  legacyEncrypted: boolean;
}

async function readPasswordRecord(env: Env): Promise<PasswordRecord | null> {
  const stored = await env.RESOURCE_KV.get(ADMIN_PASSWORD_KEY);
  if (!stored) {
    return null;
  }
  try {
    const record = JSON.parse(stored) as { hash?: unknown };
    if (typeof record.hash !== "string" || record.hash.length < 20) {
      throw new Error("password hash is invalid");
    }
    return { hash: record.hash, legacyEncrypted: false };
  } catch {
    try {
      if (!env.ADMIN_DATA_KEY) {
        throw new Error("legacy password key is unavailable");
      }
      const plaintext = await decryptSecret(stored, env.ADMIN_DATA_KEY, "ADMIN_DATA_KEY");
      const record = JSON.parse(plaintext) as { hash?: unknown };
      if (typeof record.hash !== "string" || record.hash.length < 20) {
        throw new Error("legacy password hash is invalid");
      }
      return { hash: record.hash, legacyEncrypted: true };
    } catch {
      throw new AdminError("管理员密码数据无效", 503, "admin_data_invalid");
    }
  }
}

async function writePasswordHash(env: Env, password: string): Promise<void> {
  await env.RESOURCE_KV.put(ADMIN_PASSWORD_KEY, JSON.stringify({ hash: await hashPassword(password), updatedAt: Date.now() }));
}

async function passwordMatches(env: Env, password: string): Promise<{ matched: boolean; stored: boolean; legacyEncrypted: boolean }> {
  const stored = await readPasswordRecord(env);
  if (stored) {
    return { matched: await verifyPassword(password, stored.hash), stored: true, legacyEncrypted: stored.legacyEncrypted };
  }
  const initialPassword = env.ADMIN_PASSWORD;
  return { matched: Boolean(initialPassword && equalPasswordValues(password, initialPassword)), stored: false, legacyEncrypted: false };
}

export async function hasAdminPassword(env: Env): Promise<boolean> {
  return Boolean((await readPasswordRecord(env)) || env.ADMIN_PASSWORD);
}

export async function loginAdmin(env: Env, request: Request, password: string): Promise<{ cookie: string; csrfToken: string; expiresAt: number }> {
  if (!sessionKey(env)) {
    throw new AdminError("ADMIN_SESSION_KEY is not configured", 503, "admin_misconfigured");
  }
  const limitedFor = await loginRateLimit(env, request);
  if (limitedFor) {
    throw new AdminError("登录尝试过多，请稍后再试。", 429, "login_rate_limited");
  }
  const result = await passwordMatches(env, password);
  if (!result.matched) {
    const retryAfter = await recordLoginFailure(env, request);
    const error = new AdminError("管理员密码不正确。", retryAfter ? 429 : 401, retryAfter ? "login_rate_limited" : "login_failed");
    throw error;
  }
  await clearLoginFailures(env, request);
  if (!result.stored || result.legacyEncrypted) {
    await writePasswordHash(env, password);
  }
  const created = await createAdminSession(env);
  return {
    cookie: adminCookieHeader(request, created.value),
    csrfToken: created.session.csrfToken,
    expiresAt: created.session.expiresAt,
  };
}

export async function changeAdminPassword(env: Env, currentPassword: string, newPassword: string): Promise<{ cookieValue: string; csrfToken: string; expiresAt: number }> {
  if (!isAcceptablePassword(newPassword)) {
    throw new AdminError("新密码长度应为 8 到 256 个字符。", 400, "password_invalid");
  }
  const result = await passwordMatches(env, currentPassword);
  if (!result.matched) {
    throw new AdminError("当前管理员密码不正确。", 400, "password_current_invalid");
  }
  await writePasswordHash(env, newPassword);
  await incrementNumericValue(env, ADMIN_SESSION_VERSION_KEY, 1);
  const created = await createAdminSession(env);
  return {
    cookieValue: created.value,
    csrfToken: created.session.csrfToken,
    expiresAt: created.session.expiresAt,
  };
}

export async function invalidateAdminSessions(env: Env): Promise<void> {
  await incrementNumericValue(env, ADMIN_SESSION_VERSION_KEY, 1);
}

export type { AdminSessionCookie };
