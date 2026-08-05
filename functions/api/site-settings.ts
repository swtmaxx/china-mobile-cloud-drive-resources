import type { Env } from "../../lib/env";
import { jsonResponse, publicError } from "../../lib/http";
import { readSiteSettings } from "../../lib/site-settings";

interface FunctionContext {
  env: Env;
}

export const onRequestGet = async ({ env }: FunctionContext): Promise<Response> => {
  try {
    const settings = await readSiteSettings(env);
    return jsonResponse(settings, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return publicError(error, env.DEBUG_ERRORS === "1");
  }
};
