import type { Env } from "../../lib/env";
import { Yun139Client } from "../../lib/139/client";
import { verifyResourceHandle } from "../../lib/security/handles";
import { ensureSession } from "../../lib/session";
import { readResourceRules } from "../../lib/resource-rules";
import { readDisplayRoot } from "../../lib/display-root";
import { handleSecret, isResourceVisible, rootId, isInDisplayScope } from "../../lib/resources";
import { providerEnv } from "../../lib/provider-config";
import { invalidResourceResponse, publicError } from "../../lib/http";

interface FunctionContext {
  request: Request;
  env: Env;
}

function contentTypeForName(name: string): string {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (extension) {
    case "flv":
      return "video/x-flv";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "ts":
    case "m2ts":
      return "video/mp2t";
    case "xml":
      return "application/xml; charset=utf-8";
    case "ass":
    case "ssa":
      return "text/plain; charset=utf-8";
    case "srt":
    case "vtt":
      return "text/vtt; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function asciiFallbackName(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_").trim();
  return cleaned || "file";
}

/**
 * Same-origin media proxy.
 * Browser players (especially mpegts.js for FLV) cannot fetch 139 CDN URLs directly
 * because the CDN does not send CORS headers. Download still uses 302; playback uses this.
 */
export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const configuredEnv = await providerEnv(env);
    const resource = new URL(request.url).searchParams.get("resource") || "";
    const secret = handleSecret(configuredEnv);
    const payload = await verifyResourceHandle(resource, secret);
    const rules = await readResourceRules(env);
    const displayRootState = await readDisplayRoot(env);
    if (
      !payload
      || payload.kind !== "file"
      || payload.rootId !== rootId(configuredEnv)
      || !isInDisplayScope(payload, configuredEnv, displayRootState.root)
      || !(await isResourceVisible(payload, configuredEnv, secret, rules, displayRootState.root))
    ) {
      return invalidResourceResponse();
    }

    const session = await ensureSession(configuredEnv);
    const client = new Yun139Client(configuredEnv, session.authorization);
    const upstreamUrl = await client.getDownloadUrl(payload.fileId);

    const upstreamHeaders = new Headers();
    const range = request.headers.get("Range");
    if (range) {
      upstreamHeaders.set("Range", range);
    }
    upstreamHeaders.set(
      "User-Agent",
      request.headers.get("User-Agent") || "Mozilla/5.0 (compatible; ResourceHubStream/1.0)",
    );

    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      console.error(`[resource-hub] stream upstream ${upstream.status} for ${payload.name}`);
      return new Response("上游媒体暂时不可用", {
        status: upstream.status === 403 || upstream.status === 404 ? 502 : upstream.status,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentTypeForName(payload.name));
    headers.set("Cache-Control", "private, max-age=60");
    headers.set("Accept-Ranges", upstream.headers.get("Accept-Ranges") || "bytes");
    headers.set(
      "Content-Disposition",
      `inline; filename="${asciiFallbackName(payload.name)}"; filename*=UTF-8''${encodeURIComponent(payload.name)}`,
    );

    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }
    const contentRange = upstream.headers.get("Content-Range");
    if (contentRange) {
      headers.set("Content-Range", contentRange);
    }
    headers.set("Access-Control-Allow-Origin", new URL(request.url).origin);
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return publicError(error, env.DEBUG_ERRORS === "1");
  }
};

export const onRequestHead = onRequestGet;
