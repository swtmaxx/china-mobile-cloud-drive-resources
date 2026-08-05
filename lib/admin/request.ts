import { AdminError } from "./errors";

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("object expected");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AdminError("请求内容格式不正确。", 400, "invalid_json");
  }
}

export function requiredString(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new AdminError(`${field} 格式不正确。`, 400, "invalid_input");
  }
  return value;
}
