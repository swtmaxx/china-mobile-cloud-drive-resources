import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/http";

export const onRequestGet = async (): Promise<Response> => {
  return jsonResponse({ status: "ok", service: "resource-hub" });
};
