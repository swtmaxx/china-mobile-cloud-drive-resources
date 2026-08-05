import type { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  RESOURCE_KV: KVNamespace;
  YUN139_USERNAME?: string;
  YUN139_PASSWORD?: string;
  YUN139_MAIL_COOKIES?: string;
  YUN139_AUTHORIZATION?: string;
  YUN139_TYPE?: string;
  YUN139_ROOT_ID?: string;
  AUTH_ENCRYPTION_KEY?: string;
  RESOURCE_HANDLE_KEY?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_KEY?: string;
  ADMIN_DATA_KEY?: string;
  RESOURCE_HANDLE_TTL?: string;
  RESOURCE_CACHE_TTL?: string;
  DEBUG_ERRORS?: string;
  VITE_SITE_NAME?: string;
}
