import { ProviderError } from "../139/client";
import { jsonResponse } from "../http";

export class AdminError extends Error {
  constructor(message: string, public readonly status = 500, public readonly code = "admin_error") {
    super(message);
    this.name = "AdminError";
  }
}

export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminError) {
    return jsonResponse({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ProviderError) {
    console.error(`[resource-hub] admin provider ${error.code} (${error.status}): ${error.message}`);
    return jsonResponse({ error: "云盘连接测试失败，请检查配置后重试。", code: error.code }, { status: error.status >= 500 ? 502 : error.status });
  }
  console.error(`[resource-hub] admin internal error: ${error instanceof Error ? error.message : "unknown error"}`);
  return jsonResponse({ error: "后台服务暂时不可用。", code: "internal_error" }, { status: 500 });
}
