import type { Env } from "../../lib/env";
import { Yun139Client } from "../../lib/139/client";
import { verifyResourceHandle } from "../../lib/security/handles";
import { ensureSession } from "../../lib/session";
import { readResourceRules } from "../../lib/resource-rules";
import { readDisplayRoot } from "../../lib/display-root";
import { handleSecret, isResourceVisible, rootId, isInDisplayScope } from "../../lib/resources";
import { providerEnv } from "../../lib/provider-config";
import { invalidResourceResponse, jsonResponse, publicError } from "../../lib/http";

interface FunctionContext {
  request: Request;
  env: Env;
}

function wantsDirectUrl(request: Request): boolean {
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") || "").toLowerCase();
  if (mode === "url" || mode === "json" || mode === "direct") {
    return true;
  }
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const configuredEnv = await providerEnv(env);
    const resource = new URL(request.url).searchParams.get("resource") || "";
    const secret = handleSecret(configuredEnv);
    const payload = await verifyResourceHandle(resource, secret);
    const rules = await readResourceRules(env);
    const displayRootState = await readDisplayRoot(env);
    if (!payload || payload.kind !== "file" || payload.rootId !== rootId(configuredEnv) || !isInDisplayScope(payload, configuredEnv, displayRootState.root) || !(await isResourceVisible(payload, configuredEnv, secret, rules, displayRootState.root))) {
      return invalidResourceResponse();
    }

    const session = await ensureSession(configuredEnv);
    const client = new Yun139Client(configuredEnv, session.authorization);
    const url = await client.getDownloadUrl(payload.fileId);

    // mode=url: return the CDN link only (no media proxy). Browser then plays/downloads directly from 139.
    if (wantsDirectUrl(request)) {
      return jsonResponse(
        {
          url,
          name: payload.name,
          expiresIn: 900,
        },
        {
          headers: {
            "Cache-Control": "private, max-age=30",
          },
        },
      );
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return publicError(error, env.DEBUG_ERRORS === "1");
  }
};
