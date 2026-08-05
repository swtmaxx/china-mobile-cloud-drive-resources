import type { Env } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import {
  adminCookieHeader,
  clearAdminCookie,
  invalidateAdminSessions,
  loginAdmin,
  requireAdminSession,
  requireCsrf,
} from "../../../lib/admin/auth";
import { AdminError, adminErrorResponse } from "../../../lib/admin/errors";
import { readJsonObject, requiredString } from "../../../lib/admin/request";

interface FunctionContext {
  request: Request;
  env: Env;
}

function responseForError(error: unknown): Response {
  const response = adminErrorResponse(error);
  if (error instanceof AdminError && error.code === "login_rate_limited") {
    response.headers.set("Retry-After", "900");
  }
  return response;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    return jsonResponse({ authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  } catch (error) {
    return responseForError(error);
  }
};

export const onRequestPost = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const body = await readJsonObject(request);
    const password = requiredString(body.password, "密码", 256);
    const result = await loginAdmin(env, request, password);
    return jsonResponse({ authenticated: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt }, {
      headers: { "Set-Cookie": result.cookie },
    });
  } catch (error) {
    return responseForError(error);
  }
};

export const onRequestDelete = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    requireCsrf(request, session);
    await invalidateAdminSessions(env);
    return jsonResponse({ authenticated: false }, { headers: { "Set-Cookie": clearAdminCookie(request) } });
  } catch (error) {
    return responseForError(error);
  }
};
