import type { Env } from "../../../../lib/env";
import { jsonResponse } from "../../../../lib/http";
import { Yun139Client } from "../../../../lib/139/client";
import { ensureSession } from "../../../../lib/session";
import { providerEnv, maskAccount } from "../../../../lib/provider-config";
import { rootId } from "../../../../lib/resources";
import { requireAdminSession, requireCsrf } from "../../../../lib/admin/auth";
import { adminErrorResponse } from "../../../../lib/admin/errors";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestPost = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    requireCsrf(request, session);
    const configuredEnv = await providerEnv(env);
    const providerSession = await ensureSession(configuredEnv);
    await new Yun139Client(configuredEnv, providerSession.authorization).listFiles(rootId(configuredEnv));
    return jsonResponse({
      ok: true,
      account: maskAccount(providerSession.account),
      expiresAt: providerSession.expiresAt,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
};
