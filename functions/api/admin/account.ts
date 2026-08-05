import type { Env } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import { hasAdminPassword, requireAdminSession } from "../../../lib/admin/auth";
import { adminErrorResponse } from "../../../lib/admin/errors";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    return jsonResponse({
      authenticated: true,
      account: "admin",
      passwordConfigured: await hasAdminPassword(env),
      sessionExpiresAt: session.expiresAt,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
};
