import DOMPurify from "dompurify";
import { marked } from "marked";

export interface SiteSettings {
  siteName: string;
  headerTitle: string;
  headerSubtitle: string;
  markdown: string;
  updatedAt?: number;
  version?: number;
}

export const defaultSiteSettings: SiteSettings = {
  siteName: import.meta.env.VITE_SITE_NAME || "资源分发站",
  headerTitle: "找到你需要的资源",
  headerSubtitle: "按目录浏览公开资源，文件下载由云端直连。",
  markdown: "",
};

function textOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeSiteSettings(value: unknown): SiteSettings {
  const input = value && typeof value === "object" ? value as Partial<SiteSettings> : {};
  return {
    siteName: textOrFallback(input.siteName, defaultSiteSettings.siteName),
    headerTitle: textOrFallback(input.headerTitle, defaultSiteSettings.headerTitle),
    headerSubtitle: textOrFallback(input.headerSubtitle, defaultSiteSettings.headerSubtitle),
    markdown: typeof input.markdown === "string" ? input.markdown : defaultSiteSettings.markdown,
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
