import type { Env } from "./env";
import { parseAuthorization, Yun139Client, ProviderError, sessionFromAuthorization } from "./139/client";
import type { SessionState } from "./139/types";
import { decryptSecret, encryptSecret } from "./security/secrets";
import { decodeKeyBytes } from "./security/keys";
import { persistRefreshedAuthorization, providerEnv } from "./provider-config";

const SESSION_KEY = "session:139:personal-new";
let inFlight: Promise<SessionState> | undefined;

function encryptionKey(env: Env): string {
  if (!env.AUTH_ENCRYPTION_KEY) {
    throw new ProviderError("AUTH_ENCRYPTION_KEY is not configured", 503, "server_misconfigured");
  }
  try {
    decodeKeyBytes(env.AUTH_ENCRYPTION_KEY, "AUTH_ENCRYPTION_KEY");
  } catch {
    throw new ProviderError("AUTH_ENCRYPTION_KEY is invalid", 503, "server_misconfigured");
  }
  return env.AUTH_ENCRYPTION_KEY;
}

async function readStoredSession(env: Env): Promise<SessionState | null> {
  const stored = await env.RESOURCE_KV.get(SESSION_KEY);
  if (!stored) {
    return null;
  }
  try {
    const plaintext = await decryptSecret(stored, encryptionKey(env));
    return JSON.parse(plaintext) as SessionState;
  } catch {
    // A rotated local or Pages secret can make an old KV session undecryptable.
    // Discard it so the configured Authorization or login credentials can recover.
    await env.RESOURCE_KV.delete(SESSION_KEY);
    return null;
  }
}

async function writeStoredSession(env: Env, session: SessionState): Promise<void> {
  const encrypted = await encryptSecret(JSON.stringify(session), encryptionKey(env));
  await env.RESOURCE_KV.put(SESSION_KEY, encrypted);
}

function canUse(session: SessionState): boolean {
  try {
    const parsed = parseAuthorization(session.authorization);
    const expiresAt = session.expiresAt ?? parsed.expiresAt;
    return !expiresAt || expiresAt - Date.now() > 15 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

async function ensureSessionInternal(env: Env): Promise<SessionState> {
  const configuredEnv = await providerEnv(env);
  if (configuredEnv.AUTH_ENCRYPTION_KEY) {
    encryptionKey(configuredEnv);
  }
  const stored = await readStoredSession(configuredEnv);
  const configuredAuthorization = configuredEnv.YUN139_AUTHORIZATION?.trim();
  if (configuredAuthorization) {
    try {
      const configured = sessionFromAuthorization(configuredAuthorization);
      if (canUse(configured)) {
        await writeStoredSession(configuredEnv, { ...configured, mailCookies: stored?.mailCookies });
        return { ...configured, mailCookies: stored?.mailCookies };
      }
    } catch {
      // Continue to the stored session or password recovery path.
    }
  }

  if (stored && canUse(stored)) {
    return stored;
  }

  const refreshAuthorization = configuredAuthorization || stored?.authorization;
  if (refreshAuthorization) {
    try {
      const refreshed = await new Yun139Client(configuredEnv, refreshAuthorization).refreshToken();
      const nextSession = { ...refreshed, mailCookies: stored?.mailCookies };
      try {
        await persistRefreshedAuthorization(configuredEnv, refreshed.authorization);
      } catch (error) {
        console.warn(`[resource-hub] refreshed Authorization was not persisted: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      await writeStoredSession(configuredEnv, nextSession);
      return nextSession;
    } catch {
      // Fall through to password login. MailCookies may be the only remaining recovery path.
    }
  }

  const login = await new Yun139Client(configuredEnv, refreshAuthorization || "").loginWithPassword(
    configuredEnv.YUN139_MAIL_COOKIES?.trim() || stored?.mailCookies,
  );
  const nextSession = { ...login.state, mailCookies: login.mailCookies };
  await writeStoredSession(configuredEnv, nextSession);
  return nextSession;
}

export async function ensureSession(env: Env): Promise<SessionState> {
  if (!inFlight) {
    inFlight = ensureSessionInternal(env).finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}
