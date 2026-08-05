import { describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "../lib/env";
import { sessionFromAuthorization } from "../lib/139/client";
import { ensureSession } from "../lib/session";
import { encryptSecret } from "../lib/security/secrets";

describe("session recovery", () => {
  it("rejects an invalid encryption key as a configuration error", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    } as unknown as KVNamespace;
    const authorization = btoa(`pc:13800138000:token|x|y|${Math.floor((Date.now() + 90 * 24 * 60 * 60 * 1000) / 1000)}`);
    const env = { RESOURCE_KV: kv, AUTH_ENCRYPTION_KEY: "too-short", YUN139_AUTHORIZATION: authorization } as Env;

    await expect(ensureSession(env)).rejects.toMatchObject({ status: 503, code: "server_misconfigured" });
  });

  it("discards an undecryptable KV session and restores configured Authorization", async () => {
    const configuredAuthorization = btoa(`pc:13800138000:token|x|y|${Math.floor((Date.now() + 90 * 24 * 60 * 60 * 1000) / 1000)}`);
    const currentKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const oldKey = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const storedValue = await encryptSecret(JSON.stringify(sessionFromAuthorization(configuredAuthorization)), oldKey);
    const values = new Map<string, string>([["session:139:personal-new", storedValue]]);
    const kv = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      delete: vi.fn(async (key: string) => { values.delete(key); }),
    } as unknown as KVNamespace;
    const env = {
      RESOURCE_KV: kv,
      AUTH_ENCRYPTION_KEY: currentKey,
      YUN139_AUTHORIZATION: configuredAuthorization,
    } as Env;

    const session = await ensureSession(env);

    expect(session.authorization).toBe(configuredAuthorization);
    expect(kv.delete).toHaveBeenCalledWith("session:139:personal-new");
    expect(kv.put).toHaveBeenCalledWith("session:139:personal-new", expect.any(String));
  });
});
