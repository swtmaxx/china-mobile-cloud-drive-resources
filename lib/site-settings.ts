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
  themeMode: "system" | "light" | "dark";
  faviconUrl: string;
  backgroundUrl: string;
  darkBackgroundUrl: string;
  backgroundBlur: number;
  updatedAt?: number;
}

export interface SiteSettingsState extends SiteSettings {
  version: number;
}

const DEFAULT_SITE_NAME = "swtmax · 资源站";
const DEFAULT_HEADER_TITLE = "找到你需要的资源";
const DEFAULT_HEADER_SUBTITLE = "按目录浏览公开资源，文件下载由云端直连。";
const MAX_SHORT_TEXT = 256;
const MAX_MARKDOWN = 100_000;
const MAX_CUSTOM_MARKUP = 200_000;
const MAX_URL = 2_048;
const MAX_BACKGROUND_BLUR = 32;
const THEME_MODES = new Set(["system", "light", "dark"]);

function textValue(value: unknown, fallback: string, maxLength = MAX_SHORT_TEXT): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const text = value.trim();
  return text && text.length <= maxLength ? text : fallback;
}

function optionalTextValue(value: unknown, fallback: string, maxLength = MAX_SHORT_TEXT): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const text = value.trim();
  return text.length <= maxLength ? text : fallback;
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

function themeModeValue(value: unknown, fallback: SiteSettings["themeMode"]): SiteSettings["themeMode"] {
  return typeof value === "string" && THEME_MODES.has(value) ? value as SiteSettings["themeMode"] : fallback;
}

function urlValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  if (!text || text.length > MAX_URL) {
    return "";
  }
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function isValidOptionalUrl(value: unknown): value is string {
  return typeof value === "string" && (!value.trim() || Boolean(urlValue(value)));
}

function backgroundBlurValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_BACKGROUND_BLUR ? value : fallback;
}

export function defaultSiteSettings(env: Env): SiteSettings {
  return {
    siteName: textValue(env.VITE_SITE_NAME, DEFAULT_SITE_NAME),
    headerTitle: DEFAULT_HEADER_TITLE,
    headerSubtitle: DEFAULT_HEADER_SUBTITLE,
    markdown: "",
    customHead: "",
    customContent: "",
    themeMode: "system",
    faviconUrl: "",
    backgroundUrl: "",
    darkBackgroundUrl: "",
    backgroundBlur: 0,
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
    headerTitle: optionalTextValue(stored?.headerTitle, defaults.headerTitle),
    headerSubtitle: optionalTextValue(stored?.headerSubtitle, defaults.headerSubtitle),
    markdown: markdownValue(stored?.markdown),
    customHead: markupValue(stored?.customHead),
    customContent: markupValue(stored?.customContent),
    themeMode: themeModeValue(stored?.themeMode, defaults.themeMode),
    faviconUrl: urlValue(stored?.faviconUrl),
    backgroundUrl: urlValue(stored?.backgroundUrl),
    darkBackgroundUrl: urlValue(stored?.darkBackgroundUrl),
    backgroundBlur: backgroundBlurValue(stored?.backgroundBlur, defaults.backgroundBlur),
    updatedAt: typeof stored?.updatedAt === "number" ? stored.updatedAt : undefined,
    version: await readNumericValue(env, SITE_SETTINGS_VERSION_KEY, 0),
  };
}

export async function updateSiteSettings(env: Env, patch: Record<string, unknown>): Promise<SiteSettingsState> {
  const allowed = new Set([
    "siteName",
    "headerTitle",
    "headerSubtitle",
    "markdown",
    "customHead",
    "customContent",
    "themeMode",
    "faviconUrl",
    "backgroundUrl",
    "darkBackgroundUrl",
    "backgroundBlur",
  ]);
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
    themeMode: current.themeMode,
    faviconUrl: current.faviconUrl,
    backgroundUrl: current.backgroundUrl,
    darkBackgroundUrl: current.darkBackgroundUrl,
    backgroundBlur: current.backgroundBlur,
  };
  for (const field of ["siteName", "headerTitle", "headerSubtitle"] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      continue;
    }
    if (typeof patch[field] !== "string" || patch[field].length > MAX_SHORT_TEXT) {
      throw new AdminError("个性化文本格式不正确或过长。", 400, "invalid_input");
    }
    next[field] = field === "siteName" ? textValue(patch[field], defaults[field]) : optionalTextValue(patch[field], defaults[field]);
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
  if (Object.prototype.hasOwnProperty.call(patch, "themeMode")) {
    if (typeof patch.themeMode !== "string" || !THEME_MODES.has(patch.themeMode)) {
      throw new AdminError("默认主题设置无效。", 400, "invalid_input");
    }
    next.themeMode = patch.themeMode as SiteSettings["themeMode"];
  }
  for (const field of ["faviconUrl", "backgroundUrl", "darkBackgroundUrl"] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      continue;
    }
    if (!isValidOptionalUrl(patch[field])) {
      throw new AdminError("图标或背景图片地址必须是有效的 HTTP/HTTPS URL。", 400, "invalid_input");
    }
    next[field] = urlValue(patch[field]);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "backgroundBlur")) {
    if (typeof patch.backgroundBlur !== "number" || !Number.isInteger(patch.backgroundBlur) || patch.backgroundBlur < 0 || patch.backgroundBlur > MAX_BACKGROUND_BLUR) {
      throw new AdminError("背景模糊值应为 0 到 32 之间的整数。", 400, "invalid_input");
    }
    next.backgroundBlur = patch.backgroundBlur;
  }
  next.updatedAt = Date.now();
  await writeAdminJson(env, ADMIN_SITE_SETTINGS_KEY, next);
  const version = await incrementNumericValue(env, SITE_SETTINGS_VERSION_KEY, current.version);
  return { ...next, version };
}
