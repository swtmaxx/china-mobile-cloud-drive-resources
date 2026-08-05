import type { Env } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import { providerStatus, effectiveProviderConfig, updateProviderConfig } from "../../../lib/provider-config";
import { requireAdminSession, requireCsrf } from "../../../lib/admin/auth";
import { adminErrorResponse } from "../../../lib/admin/errors";
import { readJsonObject } from "../../../lib/admin/request";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    await requireAdminSession(request, env);
    return jsonResponse(providerStatus(await effectiveProviderConfig(env)));
  } catch (error) {
    return adminErrorResponse(error);
  }
};

export const onRequestPatch = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    requireCsrf(request, session);
    const patch = await readJsonObject(request);
    await updateProviderConfig(env, patch);
    return jsonResponse({ updated: true, provider: providerStatus(await effectiveProviderConfig(env)) });
  } catch (error) {
    return adminErrorResponse(error);
  }
};
