import DOMPurify from "dompurify";
import { marked } from "marked";

export type ThemeMode = "system" | "light" | "dark";

export interface SiteSettings {
  siteName: string;
  headerTitle: string;
  headerSubtitle: string;
  markdown: string;
  customHead: string;
  customContent: string;
  themeMode: ThemeMode;
  faviconUrl: string;
  backgroundUrl: string;
  darkBackgroundUrl: string;
  backgroundBlur: number;
  updatedAt?: number;
  version?: number;
}

export const defaultSiteSettings: SiteSettings = {
  siteName: import.meta.env.VITE_SITE_NAME || "资源分发站",
  headerTitle: "找到你需要的资源",
  headerSubtitle: "按目录浏览公开资源，文件下载由云端直连。",
  markdown: "",
  customHead: "",
  customContent: "",
  themeMode: "system",
  faviconUrl: "",
  backgroundUrl: "",
  darkBackgroundUrl: "",
  backgroundBlur: 0,
};

function textOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalTextOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeSiteSettings(value: unknown): SiteSettings {
  const input = value && typeof value === "object" ? value as Partial<SiteSettings> : {};
  return {
    siteName: textOrFallback(input.siteName, defaultSiteSettings.siteName),
    headerTitle: optionalTextOrFallback(input.headerTitle, defaultSiteSettings.headerTitle),
    headerSubtitle: optionalTextOrFallback(input.headerSubtitle, defaultSiteSettings.headerSubtitle),
    markdown: typeof input.markdown === "string" ? input.markdown : defaultSiteSettings.markdown,
    customHead: typeof input.customHead === "string" ? input.customHead : defaultSiteSettings.customHead,
    customContent: typeof input.customContent === "string" ? input.customContent : defaultSiteSettings.customContent,
    themeMode: input.themeMode === "light" || input.themeMode === "dark" ? input.themeMode : defaultSiteSettings.themeMode,
    faviconUrl: normalizeUrl(input.faviconUrl),
    backgroundUrl: normalizeUrl(input.backgroundUrl),
    darkBackgroundUrl: normalizeUrl(input.darkBackgroundUrl),
    backgroundBlur: typeof input.backgroundBlur === "number" && Number.isInteger(input.backgroundBlur) && input.backgroundBlur >= 0 && input.backgroundBlur <= 32 ? input.backgroundBlur : defaultSiteSettings.backgroundBlur,
    ...(typeof input.updatedAt === "number" ? { updatedAt: input.updatedAt } : {}),
    ...(typeof input.version === "number" ? { version: input.version } : {}),
  };
}

const markdownTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
];

const markdownAttributes = ["alt", "colspan", "href", "rel", "rowspan", "src", "title"];

export function renderMarkdown(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }
  const rendered = marked.parse(markdown, { async: false, gfm: true });
  return DOMPurify.sanitize(typeof rendered === "string" ? rendered : "", {
    ALLOWED_TAGS: markdownTags,
    ALLOWED_ATTR: markdownAttributes,
    FORBID_ATTR: ["style", "onerror", "onclick", "onload"],
  });
}
