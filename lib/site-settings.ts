import type { Env } from "./env";
import { AdminError } from "./admin/errors";
import {
  ADMIN_SITE_SETTINGS_KEY,
  incrementNumericValue,
  readAdminJson,
  readNumericValue,
  SITE_SETTINGS_VERSION_KEY,
  writeAdminJson,
} from "./admin/storage";

export interface SiteSettings {
  siteName: string;
  headerTitle: string;
  headerSubtitle: string;
  markdown: string;
  customHead: string;
  customContent: string;
  updatedAt?: number;
}

export interface SiteSettingsState extends SiteSettings {
  version: number;
}

const DEFAULT_SITE_NAME = "资源分发站";
const DEFAULT_HEADER_TITLE = "找到你需要的资源";
const DEFAULT_HEADER_SUBTITLE = "按目录浏览公开资源，文件下载由云端直连。";
const MAX_SHORT_TEXT = 256;
const MAX_MARKDOWN = 100_000;
const MAX_CUSTOM_MARKUP = 200_000;

function textValue(value: unknown, fallback: string, maxLength = MAX_SHORT_TEXT): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const text = value.trim();
  return text && text.length <= maxLength ? text : fallback;
}

function markdownValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  return text.length <= MAX_MARKDOWN ? text : "";
}

function markupValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  return text.length <= MAX_CUSTOM_MARKUP ? text : "";
}

export function defaultSiteSettings(env: Env): SiteSettings {
  return {
    siteName: textValue(env.VITE_SITE_NAME, DEFAULT_SITE_NAME),
    headerTitle: DEFAULT_HEADER_TITLE,
    headerSubtitle: DEFAULT_HEADER_SUBTITLE,
    markdown: "",
    customHead: "",
    customContent: "",
  };
}

export async function readSiteSettings(env: Env, recoverCorrupt = false): Promise<SiteSettingsState> {
  let stored: Partial<SiteSettings> | null;
  try {
    stored = await readAdminJson<Partial<SiteSettings>>(env, ADMIN_SITE_SETTINGS_KEY);
  } catch (error) {
    if (!recoverCorrupt || !(error instanceof AdminError) || error.code !== "admin_data_invalid") {
      throw error;
    }
    stored = null;
  }
  const defaults = defaultSiteSettings(env);
  return {
    siteName: textValue(stored?.siteName, defaults.siteName),
    headerTitle: textValue(stored?.headerTitle, defaults.headerTitle),
    headerSubtitle: textValue(stored?.headerSubtitle, defaults.headerSubtitle),
    markdown: markdownValue(stored?.markdown),
    customHead: markupValue(stored?.customHead),
    customContent: markupValue(stored?.customContent),
    updatedAt: typeof stored?.updatedAt === "number" ? stored.updatedAt : undefined,
    version: await readNumericValue(env, SITE_SETTINGS_VERSION_KEY, 0),
  };
}

export async function updateSiteSettings(env: Env, patch: Record<string, unknown>): Promise<SiteSettingsState> {
  const allowed = new Set(["siteName", "headerTitle", "headerSubtitle", "markdown", "customHead", "customContent"]);
  const unknown = Object.keys(patch).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new AdminError("个性化设置包含不支持的字段。", 400, "invalid_input");
  }
  if (Object.keys(patch).length === 0) {
    throw new AdminError("至少需要修改一个个性化设置字段。", 400, "invalid_input");
  }

  const current = await readSiteSettings(env, true);
  const defaults = defaultSiteSettings(env);
  const next: SiteSettings = {
    siteName: current.siteName,
    headerTitle: current.headerTitle,
    headerSubtitle: current.headerSubtitle,
    markdown: current.markdown,
    customHead: current.customHead,
    customContent: current.customContent,
  };
  for (const field of ["siteName", "headerTitle", "headerSubtitle"] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      continue;
    }
    if (typeof patch[field] !== "string" || patch[field].length > MAX_SHORT_TEXT) {
      throw new AdminError("个性化文本格式不正确或过长。", 400, "invalid_input");
    }
    next[field] = textValue(patch[field], defaults[field]);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "markdown")) {
    if (typeof patch.markdown !== "string" || patch.markdown.length > MAX_MARKDOWN) {
      throw new AdminError("Markdown 内容格式不正确或过长。", 400, "invalid_input");
    }
    next.markdown = markdownValue(patch.markdown);
  }
  for (const field of ["customHead", "customContent"] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      continue;
    }
    if (typeof patch[field] !== "string" || patch[field].length > MAX_CUSTOM_MARKUP) {
      throw new AdminError("自定义代码格式不正确或过长。", 400, "invalid_input");
    }
    next[field] = markupValue(patch[field]);
  }
  next.updatedAt = Date.now();
  await writeAdminJson(env, ADMIN_SITE_SETTINGS_KEY, next);
  const version = await incrementNumericValue(env, SITE_SETTINGS_VERSION_KEY, current.version);
  return { ...next, version };
}
