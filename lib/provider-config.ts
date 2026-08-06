import type { Env } from "./env";
import { parseAuthorization } from "./139/client";
import { AdminError } from "./admin/errors";
import { readAdminJson, writeAdminJson, ADMIN_PROVIDER_KEY, incrementNumericValue, PROVIDER_CONFIG_VERSION_KEY, deleteAdminValue } from "./admin/storage";

export interface ProviderConfig {
  username?: string | null;
  password?: string | null;
  mailCookies?: string | null;
  authorization?: string | null;
  type?: string | null;
  rootId?: string | null;
  updatedAt?: number;
}

const secretFields = ["username", "password", "mailCookies", "authorization"] as const;
const configFields = ["username", "password", "mailCookies", "authorization", "type", "rootId"] as const;

export async function readStoredProviderConfig(env: Env): Promise<ProviderConfig | null> {
  return readAdminJson<ProviderConfig>(env, ADMIN_PROVIDER_KEY);
}

export async function effectiveProviderConfig(env: Env): Promise<ProviderConfig> {
  const stored = await readStoredProviderConfig(env);
  const value = <K extends keyof ProviderConfig>(field: K, fallback: ProviderConfig[K]): ProviderConfig[K] => (
    stored && Object.prototype.hasOwnProperty.call(stored, field) ? stored[field] ?? undefined : fallback
  );
  return {
    username: value("username", env.YUN139_USERNAME),
    password: value("password", env.YUN139_PASSWORD),
    mailCookies: value("mailCookies", env.YUN139_MAIL_COOKIES),
    authorization: value("authorization", env.YUN139_AUTHORIZATION),
    type: value("type", env.YUN139_TYPE),
    rootId: value("rootId", env.YUN139_ROOT_ID),
    updatedAt: stored?.updatedAt,
  };
}

export async function providerEnv(env: Env): Promise<Env> {
  const config = await effectiveProviderConfig(env);
  return {
    ...env,
    YUN139_USERNAME: config.username ?? undefined,
    YUN139_PASSWORD: config.password ?? undefined,
    YUN139_MAIL_COOKIES: config.mailCookies ?? undefined,
    YUN139_AUTHORIZATION: config.authorization ?? undefined,
    YUN139_TYPE: config.type ?? undefined,
    YUN139_ROOT_ID: config.rootId ?? undefined,
  };
}

export function maskAccount(value?: string | null): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= 3) {
    return `${text.slice(0, 1)}***`;
  }
  if (text.length <= 6) {
    return `${text.slice(0, 1)}***${text.slice(-1)}`;
  }
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function authorizationStatus(value?: string | null): { configured: boolean; account?: string; expiresAt?: number; expired?: boolean } {
  if (!value?.trim()) {
    return { configured: false };
  }
  try {
    const parsed = parseAuthorization(value);
    return {
      configured: true,
      account: maskAccount(parsed.account),
      expiresAt: parsed.expiresAt,
      expired: parsed.expiresAt !== undefined && parsed.expiresAt <= Date.now(),
    };
  } catch {
    return { configured: true, expired: undefined };
  }
}

export function providerStatus(config: ProviderConfig): {
  usernameMasked?: string;
  usernameConfigured: boolean;
  passwordConfigured: boolean;
  mailCookiesConfigured: boolean;
  authorizationConfigured: boolean;
  authorizationAccount?: string;
  authorizationExpiresAt?: number;
  authorizationExpired?: boolean;
  type: string;
  rootId: string;
  updatedAt?: number;
} {
  const authorization = authorizationStatus(config.authorization);
  return {
    usernameMasked: maskAccount(config.username),
    usernameConfigured: Boolean(config.username?.trim()),
    passwordConfigured: Boolean(config.password),
    mailCookiesConfigured: Boolean(config.mailCookies?.trim()),
    authorizationConfigured: authorization.configured,
    authorizationAccount: authorization.account,
    authorizationExpiresAt: authorization.expiresAt,
    authorizationExpired: authorization.expired,
    type: config.type === "family" ? "family" : "personal_new",
    rootId: config.rootId?.trim() || "/",
    updatedAt: config.updatedAt,
  };
}

export function providerConfigFields(): readonly string[] {
  return configFields;
}

export function secretProviderFields(): readonly string[] {
  return secretFields;
}

export async function updateProviderConfig(env: Env, patch: Record<string, unknown>): Promise<ProviderConfig> {
  const allowed = new Set(configFields);
  const unknown = Object.keys(patch).filter((field) => !allowed.has(field as typeof configFields[number]));
  if (unknown.length > 0) {
    throw new AdminError("云盘配置包含不支持的字段。", 400, "invalid_input");
  }
  if (Object.keys(patch).length === 0) {
    throw new AdminError("至少需要修改一个云盘配置字段。", 400, "invalid_input");
  }
  let current: ProviderConfig = {};
  try {
    current = (await readStoredProviderConfig(env)) || {};
  } catch (error) {
    if (!(error instanceof AdminError) || error.code !== "admin_data_invalid") {
      throw error;
    }
    // A rotated ADMIN_DATA_KEY makes old credentials unreadable. A complete
    // PATCH can replace that record so the administrator can recover without
    // manually editing KV.
  }
  const next: ProviderConfig = { ...current };
  for (const field of configFields) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      continue;
    }
    const value = patch[field];
    if (value === null || value === "") {
      next[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      throw new AdminError("云盘配置字段格式不正确。", 400, "invalid_input");
    }
    const maxLength = field === "mailCookies" || field === "authorization" ? 100_000 : field === "password" ? 4_096 : field === "rootId" ? 1_024 : 256;
    if (value.length > maxLength) {
      throw new AdminError("云盘配置字段过长。", 400, "invalid_input");
    }
    if (field === "type" && value !== "personal_new" && value !== "family") {
      throw new AdminError("云盘类型不受支持。", 400, "invalid_input");
    }
    next[field] = field === "password" ? value : value.trim();
  }
  next.updatedAt = Date.now();
  await writeAdminJson(env, ADMIN_PROVIDER_KEY, next);
  await invalidateProviderSession(env);
  return next;
}

export async function persistRefreshedAuthorization(env: Env, authorization: string): Promise<void> {
  if (!env.ADMIN_DATA_KEY) {
    return;
  }
  const current = (await readStoredProviderConfig(env)) || {};
  if (current.authorization === authorization) {
    return;
  }
  await writeAdminJson(env, ADMIN_PROVIDER_KEY, {
    ...current,
    authorization,
    updatedAt: Date.now(),
  });
  await invalidateProviderSession(env);
}

export async function invalidateProviderSession(env: Env): Promise<void> {
  await deleteAdminValue(env, "session:139:personal-new");
  await incrementNumericValue(env, PROVIDER_CONFIG_VERSION_KEY, 0);
}
