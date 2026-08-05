import { ProviderError } from "./139/client";

const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(baseHeaders);
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function publicError(error: unknown, debug = false): Response {
  if (error instanceof ProviderError) {
    console.error(`[resource-hub] provider ${error.code} (${error.status}): ${error.message}`);
    const status = error.code === "credentials_missing" || error.code === "server_misconfigured"
      ? 503
      : error.status === 401
        ? 503
        : error.status === 504
          ? 504
          : 502;
    return jsonResponse({ error: debug ? error.message : "资源服务暂时不可用", code: error.code }, { status });
  }
  console.error(`[resource-hub] internal error: ${error instanceof Error ? error.message : "unknown error"}`);
  return jsonResponse({ error: debug && error instanceof Error ? error.message : "服务暂时不可用", code: "internal_error" }, { status: 500 });
}

export function invalidResourceResponse(): Response {
  return jsonResponse({ error: "资源不存在或链接已失效", code: "resource_invalid" }, { status: 404 });
}
