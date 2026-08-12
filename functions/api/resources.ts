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
  resolvePathDirectory,
} from "../../lib/resources";
import { invalidResourceResponse, jsonResponse, publicError } from "../../lib/http";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const configuredEnv = await providerEnv(env);
    const url = new URL(request.url);
    const dir = url.searchParams.get("dir") || "root";
    const pathParam = url.searchParams.get("path");
    const secret = handleSecret(configuredEnv);
    const rules = await readResourceRules(env);
    const displayRootState = await readDisplayRoot(env);
    const providerVersion = await readNumericValue(env, PROVIDER_CONFIG_VERSION_KEY, 0);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const target = pathParam !== null
      ? await resolvePathDirectory(pathParam, configuredEnv, secret, rules, displayRootState.root, providerVersion, forceRefresh)
      : await resolveDirectory(dir, configuredEnv, secret, displayRootState.root);
    if (!target || (target.payload && !(await isResourceVisible(target.payload, configuredEnv, secret, rules, displayRootState.root)))) {
      return invalidResourceResponse();
    }
    const cacheKey = publicCacheKey(target, providerVersion, rules.version, displayRootState.version);
    const cached = forceRefresh ? null : await env.RESOURCE_KV.get(cacheKey);
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
    const items = await listDirectoryItems(configuredEnv, target, providerVersion, forceRefresh);
    const payload = await buildDirectoryResponse(configuredEnv, target, items, secret, rules.hiddenIds, target.scopeRootId, displayRootState.root?.name || "资源根目录");
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
