import type { Env } from "../../lib/env";
import { ensureSession } from "../../lib/session";
import { readNumericValue, PROVIDER_CONFIG_VERSION_KEY } from "../../lib/admin/storage";
import { readResourceRules } from "../../lib/resource-rules";
import { readDisplayRoot } from "../../lib/display-root";
import { providerEnv } from "../../lib/provider-config";
import {
  buildDirectoryResponse,
  cacheTtl,
  handleSecret,
  isResourceVisible,
  listDirectoryItems,
  publicCacheKey,
  resolveDirectory,
} from "../../lib/resources";
import { invalidResourceResponse, jsonResponse, publicError } from "../../lib/http";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const configuredEnv = await providerEnv(env);
    const dir = new URL(request.url).searchParams.get("dir") || "root";
    const secret = handleSecret(configuredEnv);
    const rules = await readResourceRules(env);
    const displayRootState = await readDisplayRoot(env);
    const target = await resolveDirectory(dir, configuredEnv, secret, displayRootState.root);
    if (!target || (target.payload && !(await isResourceVisible(target.payload, configuredEnv, secret, rules, displayRootState.root)))) {
      return invalidResourceResponse();
    }

    const providerVersion = await readNumericValue(env, PROVIDER_CONFIG_VERSION_KEY, 0);
    const cacheKey = publicCacheKey(target, providerVersion, rules.version, displayRootState.version);
    const cached = await env.RESOURCE_KV.get(cacheKey);
    if (cached) {
      try {
        return jsonResponse(JSON.parse(cached), {
          headers: {
            "Cache-Control": `public, max-age=0, s-maxage=${cacheTtl(env)}, stale-while-revalidate=60`,
          },
        });
      } catch {
        await env.RESOURCE_KV.delete(cacheKey);
      }
    }

    await ensureSession(configuredEnv);
    const items = await listDirectoryItems(configuredEnv, target, providerVersion);
    const payload = await buildDirectoryResponse(configuredEnv, target, items, secret, rules.hiddenIds, target.scopeRootId);
    await env.RESOURCE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: cacheTtl(configuredEnv) });
    return jsonResponse(payload, {
      headers: {
        "Cache-Control": `public, max-age=0, s-maxage=${cacheTtl(env)}, stale-while-revalidate=60`,
      },
    });
  } catch (error) {
    return publicError(error, env.DEBUG_ERRORS === "1");
  }
};
