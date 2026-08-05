import type { Env } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import { requireAdminSession, requireCsrf } from "../../../lib/admin/auth";
import { adminErrorResponse } from "../../../lib/admin/errors";
import { readJsonObject } from "../../../lib/admin/request";
import { readSiteSettings, updateSiteSettings } from "../../../lib/site-settings";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    await requireAdminSession(request, env);
    return jsonResponse(await readSiteSettings(env, true));
  } catch (error) {
    return adminErrorResponse(error);
  }
};

export const onRequestPatch = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    requireCsrf(request, session);
    const patch = await readJsonObject(request);
    return jsonResponse(await updateSiteSettings(env, patch));
  } catch (error) {
    return adminErrorResponse(error);
  }
};
