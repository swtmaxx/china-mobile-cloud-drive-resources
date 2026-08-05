import type { Env } from "../../../../lib/env";
import { jsonResponse } from "../../../../lib/http";
import {
  adminCookieHeader,
  changeAdminPassword,
  requireAdminSession,
  requireCsrf,
} from "../../../../lib/admin/auth";
import { adminErrorResponse } from "../../../../lib/admin/errors";
import { readJsonObject, requiredString } from "../../../../lib/admin/request";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestPost = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    requireCsrf(request, session);
    const body = await readJsonObject(request);
    const currentPassword = requiredString(body.currentPassword, "当前密码", 256);
    const newPassword = requiredString(body.newPassword, "新密码", 256);
    const result = await changeAdminPassword(env, currentPassword, newPassword);
    return jsonResponse({ authenticated: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt }, {
      headers: { "Set-Cookie": adminCookieHeader(request, result.cookieValue) },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
};
