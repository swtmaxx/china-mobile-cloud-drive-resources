import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileType,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  HardDriveDownload,
  Moon,
  RefreshCw,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { defaultSiteSettings, normalizeSiteSettings, PAGE_TITLE, renderMarkdown, SiteSettings, ThemeMode } from "./site-settings";
import Player, { fileExtension, findDanmakuHandle, isVideoFile } from "./Player";

interface ResourceItem {
  handle: string;
  kind: "folder" | "file";
  name: string;
  size: number;
  updatedAt?: string;
  extension?: string;
}

interface DirectoryResponse {
  current: {
    name: string;
    handle: string;
    parentHandle?: string;
    parentName?: string;
  };
  rootName: string;
  items: ResourceItem[];
  cachedAt: string;
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
}

interface TrailItem {
  handle: string;
  name: string;
}

type ResolvedTheme = "light" | "dark";
type OrderBy = "name" | "size" | "modified";

const THEME_OVERRIDE_KEY = "resource-hub-theme";
const SORT_KEY_PREFIX = "resource-hub-dir-sort:";

interface SortState {
  orderBy: OrderBy;
  reverse: boolean;
}

const DEFAULT_SORT: SortState = { orderBy: "name", reverse: false };

function isOrderBy(value: unknown): value is OrderBy {
  return value === "name" || value === "size" || value === "modified";
}

function loadSortState(dir: string): SortState {
  try {
    const raw = window.localStorage.getItem(`${SORT_KEY_PREFIX}${dir}`);
    if (!raw) {
      return DEFAULT_SORT;
    }
    const parsed = JSON.parse(raw) as Partial<SortState>;
    if (!isOrderBy(parsed.orderBy)) {
      return DEFAULT_SORT;
    }
    return { orderBy: parsed.orderBy, reverse: Boolean(parsed.reverse) };
  } catch {
    return DEFAULT_SORT;
  }
}

function saveSortState(dir: string, state: SortState): void {
  try {
    window.localStorage.setItem(`${SORT_KEY_PREFIX}${dir}`, JSON.stringify(state));
  } catch {
    // Ignore storage failures in private mode.
  }
}

function compareNaturalName(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

function compareItems(left: ResourceItem, right: ResourceItem, orderBy: OrderBy, reverse: boolean): number {
  // Folders stay grouped in front, matching common file-manager UX.
  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1;
  }

  let result = 0;
  switch (orderBy) {
    case "size":
      result = (left.size || 0) - (right.size || 0);
      if (result === 0) {
        result = compareNaturalName(left.name, right.name);
      }
      break;
    case "modified": {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      result = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
      if (result === 0) {
        result = compareNaturalName(left.name, right.name);
      }
      break;
    }
    case "name":
    default:
      result = compareNaturalName(left.name, right.name);
      break;
  }
  return reverse ? -result : result;
}

function readThemeOverride(): ResolvedTheme | null {
  try {
    const value = window.localStorage.getItem(THEME_OVERRIDE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function readSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode, systemTheme: ResolvedTheme, override: ResolvedTheme | null): ResolvedTheme {
  if (override) {
    return override;
  }
  return mode === "system" ? systemTheme : mode;
}

function cssBackgroundImage(url: string): string {
  if (!url) {
    return "none";
  }
  return `url("${url}")`;
}

function readDirectory(): string {
  return new URLSearchParams(window.location.search).get("path") || "/";
}

function readWatchFile(): string {
  return new URLSearchParams(window.location.search).get("file") || "";
}

function iconFor(item: ResourceItem): { icon: LucideIcon; className: string } {
  if (item.kind === "folder") {
    return { icon: Folder, className: "folder" };
  }
  const ext = (item.extension || "").toLowerCase();
  if (["mp4", "mkv", "webm", "mov", "m4v", "flv", "m2ts", "ts", "avi", "wmv", "rmvb", "mpg", "mpeg", "3gp", "ogv", "ogg"].includes(ext)) {
    return { icon: Film, className: "video" };
  }
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "avif", "ico"].includes(ext)) {
    return { icon: FileImage, className: "image" };
  }
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "ape", "amr"].includes(ext)) {
    return { icon: FileMusic, className: "audio" };
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "cab"].includes(ext)) {
    return { icon: FileArchive, className: "archive" };
  }
  if (ext === "pdf") {
    return { icon: FileType, className: "pdf" };
  }
  if (["js", "ts", "tsx", "jsx", "py", "go", "rs", "java", "c", "cpp", "h", "hpp", "html", "css", "scss", "less", "json", "xml", "yaml", "yml", "toml", "ini", "sh", "bat", "ps1", "sql", "php", "rb", "swift", "kt", "vue", "svelte", "md", "markdown", "conf", "cfg", "env"].includes(ext)) {
    return { icon: FileCode, className: "code" };
  }
  if (["xls", "xlsx", "csv", "tsv", "ods"].includes(ext)) {
    return { icon: FileSpreadsheet, className: "sheet" };
  }
  if (["txt", "doc", "docx", "ppt", "pptx", "odt", "rtf", "log", "srt", "ass", "vtt"].includes(ext)) {
    return { icon: FileText, className: "text" };
  }
  return { icon: File, className: "file" };
}

function formatSize(size: number): string {
  if (!size) {
    return "文件夹";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function downloadUrl(handle: string): string {
  return `/api/download?resource=${encodeURIComponent(handle)}`;
}

/** Ask the API for the 139 CDN link only — media bytes go browser ↔ CDN (not through the Worker). */
async function resolveDirectUrl(handle: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${downloadUrl(handle)}&mode=url`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json().catch(() => null) as { url?: string; error?: string } | null;
  if (!response.ok || !payload?.url) {
    throw new Error(payload?.error || "无法获取直连播放地址");
  }
  return payload.url;
}

const AUTO_NEXT_KEY = "resource-hub-video-auto-next";

function readAutoNext(): boolean {
  try {
    const value = window.localStorage.getItem(AUTO_NEXT_KEY);
    return value === null ? true : value === "true";
  } catch {
    return true;
  }
}

function errorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  switch (payload?.code) {
    case "resource_invalid":
      return "这个目录链接已失效，请返回资源根目录重新打开。";
    case "credentials_missing":
    case "server_misconfigured":
      return "资源站暂时未完成云盘连接配置。";
    case "refresh_failed":
    case "refresh_rejected":
      return "云盘会话已过期，站点正在等待维护者更新登录状态。";
    default:
      return payload?.error || fallback;
  }
}

function executableMarkupNode(node: Node): Node {
  const clone = node.cloneNode(true);
  if (!(clone instanceof Element)) {
    return clone;
  }
  if (clone.tagName.toLowerCase() === "script") {
    const script = document.createElement("script");
    for (const attribute of Array.from(clone.attributes)) {
      script.setAttribute(attribute.name, attribute.value);
    }
    script.textContent = clone.textContent;
    return script;
  }
  for (const script of Array.from(clone.querySelectorAll("script"))) {
    script.replaceWith(executableMarkupNode(script));
  }
  return clone;
}

function mountMarkup(markup: string, target: Node): () => void {
  if (!markup.trim()) {
    return () => undefined;
  }
  const template = document.createElement("template");
  template.innerHTML = markup;
  const nodes = Array.from(template.content.childNodes).map(executableMarkupNode);
  nodes.forEach((node) => target.appendChild(node));
  return () => {
    nodes.forEach((node) => node.parentNode?.removeChild(node));
  };
}

function CustomHead({ markup }: { markup: string }) {
  useEffect(() => mountMarkup(markup, document.head), [markup]);
  return null;
}

function CustomContent({ markup }: { markup: string }) {
  const container = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!container.current) {
      return undefined;
    }
    return mountMarkup(markup, container.current);
  }, [markup]);

  if (!markup.trim()) {
    return null;
  }
  return <div className="custom-content" ref={container} />;
}

function App() {
  const [directory, setDirectory] = useState(readDirectory);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(defaultSiteSettings);
  const [rootName, setRootName] = useState("资源根目录");
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const [watchFile, setWatchFile] = useState(readWatchFile);
  const [watchMode, setWatchMode] = useState<"player" | "download">("player");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("暂时无法读取资源目录。");
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const [themeOverride, setThemeOverride] = useState<ResolvedTheme | null>(readThemeOverride);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);
  const resolvedTheme = resolveTheme(siteSettings.themeMode, systemTheme, themeOverride);
  const [sortState, setSortState] = useState<SortState>(() => loadSortState(readDirectory()));
  const [autoNext, setAutoNext] = useState(readAutoNext);
  const [directPlayUrl, setDirectPlayUrl] = useState<string>("");
  const [directDanmakuUrl, setDirectDanmakuUrl] = useState<string | undefined>(undefined);
  const [directUrlError, setDirectUrlError] = useState<string>("");
  const [directUrlLoading, setDirectUrlLoading] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    const background = resolvedTheme === "dark"
      ? siteSettings.darkBackgroundUrl || siteSettings.backgroundUrl
      : siteSettings.backgroundUrl || siteSettings.darkBackgroundUrl;
    root.style.setProperty("--site-background-image", cssBackgroundImage(background));
    root.style.setProperty("--site-background-blur", `${siteSettings.backgroundBlur}px`);
    return () => {
      delete root.dataset.theme;
      root.style.removeProperty("--site-background-image");
      root.style.removeProperty("--site-background-blur");
    };
  }, [resolvedTheme, siteSettings.backgroundBlur, siteSettings.backgroundUrl, siteSettings.darkBackgroundUrl]);

  useEffect(() => {
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-resource-hub-favicon]"));
    links.forEach((link) => link.remove());
    if (!siteSettings.faviconUrl) {
      return undefined;
    }
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = siteSettings.faviconUrl;
    link.dataset.resourceHubFavicon = "true";
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [siteSettings.faviconUrl]);

  function toggleTheme() {
    const nextTheme: ResolvedTheme = resolvedTheme === "dark" ? "light" : "dark";
    setThemeOverride(nextTheme);
    try {
      window.localStorage.setItem(THEME_OVERRIDE_KEY, nextTheme);
    } catch {
      // Continue without persistence when browser storage is unavailable.
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/site-settings", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("site settings unavailable");
        }
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (active) {
          setSiteSettings(normalizeSiteSettings(payload));
        }
      })
      .catch(() => {
        // Keep the directory usable when the optional settings endpoint is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  const loadDirectory = useCallback(async (handle: string, refresh = false) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setStatus("loading");
    setError("");
    setSelected(null);
    try {
      const response = await fetch(`/api/resources?path=${encodeURIComponent(handle)}${refresh ? "&refresh=1" : ""}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as (DirectoryResponse & ApiErrorPayload) | null;
      if (sequence !== requestSequence.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(errorMessage(payload, "暂时无法读取资源目录。"));
      }
      if (!payload?.current || !Array.isArray(payload.items)) {
        throw new Error("资源目录返回格式不正确。");
      }
      setData(payload);
      setRootName(payload.rootName || payload.current.name);
      setStatus("ready");
    } catch (requestError) {
      if (sequence !== requestSequence.current) {
        return;
      }
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("读取资源目录超时，请检查站点连接后重试。");
        setStatus("error");
        return;
      }
      setStatus("error");
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取资源目录。");
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const nextDirectory = readDirectory();
      setDirectory(nextDirectory);
      setWatchFile(readWatchFile());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      activeRequest.current?.abort();
    };
  }, [rootName]);

  useEffect(() => {
    void loadDirectory(directory);
  }, [directory, loadDirectory]);

  useEffect(() => {
    setSortState(loadSortState(directory));
  }, [directory]);

  function toggleSort(column: OrderBy) {
    setSortState((previous) => {
      const next: SortState = previous.orderBy === column
        ? { orderBy: column, reverse: !previous.reverse }
        : { orderBy: column, reverse: false };
      saveSortState(directory, next);
      return next;
    });
  }

  const pathSegments = useMemo(() => {
    const segments = directory.split("/").filter(Boolean);
    const items: TrailItem[] = [{ handle: "/", name: rootName }];
    let accumulated = "";
    for (const segment of segments) {
      accumulated += `/${segment}`;
      items.push({ handle: accumulated, name: segment });
    }
    return items;
  }, [directory, rootName]);

  function buildDirectoryUrl(path: string, extra?: Array<[string, string]>): string {
    const parts: string[] = [];
    if (path && path !== "/") {
      const encodedPath = path.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
      parts.push(`path=/${encodedPath}`);
    }
    for (const [key, value] of extra || []) {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
    return parts.length > 0 ? `/?${parts.join("&")}` : "/";
  }

  function navigate(path: string) {
    setWatchFile("");
    const url = buildDirectoryUrl(path);
    window.history.pushState({}, "", url);
    setDirectory(path && path !== "/" ? path : "/");
  }

  function navigateWatch(handle: string) {
    const url = buildDirectoryUrl(directory, [["file", handle]]);
    window.history.pushState({}, "", url);
    setSelected(null);
    setWatchFile(handle);
  }

  function leaveWatch() {
    const url = buildDirectoryUrl(directory);
    window.history.pushState({}, "", url);
    setWatchFile("");
  }

  function goBack() {
    if (directory === "/") {
      return;
    }
    const parentPath = directory.slice(0, directory.lastIndexOf("/")) || "/";
    navigate(parentPath);
  }

  const sortedItems = useMemo(() => {
    if (!data) {
      return [];
    }
    return [...data.items].sort((left, right) => compareItems(left, right, sortState.orderBy, sortState.reverse));
  }, [data, sortState]);

  function sortHeaderClass(column: OrderBy): string {
    return `sort-header${sortState.orderBy === column ? " active" : ""}`;
  }

  function sortIndicator(column: OrderBy) {
    if (sortState.orderBy !== column) {
      return null;
    }
    return sortState.reverse
      ? <ArrowDown size={13} strokeWidth={2.4} aria-hidden="true" />
      : <ArrowUp size={13} strokeWidth={2.4} aria-hidden="true" />;
  }

  const selectedIsVideo = selected ? isVideoFile(selected.extension, selected.name) : false;
  const selectedIcon = selected ? iconFor(selected) : null;
  const watchItem = watchFile && data
    ? data.items.find((item) => item.handle === watchFile) || null
    : null;
  const watchDanmakuHandle = watchItem
    ? findDanmakuHandle(watchItem.name, data?.items || [])
    : undefined;

  const directoryVideos = useMemo(() => {
    if (!data) {
      return [] as ResourceItem[];
    }
    return sortedItems.filter((item) => item.kind === "file" && isVideoFile(item.extension, item.name));
  }, [data, sortedItems]);

  const watchVideoIndex = watchItem
    ? directoryVideos.findIndex((item) => item.handle === watchItem.handle)
    : -1;

  function selectVideoByHandle(handle: string) {
    const next = directoryVideos.find((item) => item.handle === handle) || data?.items.find((item) => item.handle === handle);
    if (next) {
      navigateWatch(next.handle);
    }
  }

  function playAdjacentVideo(offset: number) {
    if (watchVideoIndex < 0) {
      return;
    }
    const next = directoryVideos[watchVideoIndex + offset];
    if (next) {
      navigateWatch(next.handle);
    }
  }

  function handleVideoEnded() {
    if (!autoNext) {
      return;
    }
    playAdjacentVideo(1);
  }

  function toggleAutoNext(checked: boolean) {
    setAutoNext(checked);
    try {
      window.localStorage.setItem(AUTO_NEXT_KEY, String(checked));
    } catch {
      // Ignore storage failures.
    }
  }

  useEffect(() => {
    if (!watchItem || !isVideoFile(watchItem.extension, watchItem.name)) {
      setDirectPlayUrl("");
      setDirectDanmakuUrl(undefined);
      setDirectUrlError("");
      setDirectUrlLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const danmakuHandle = watchDanmakuHandle;
    setDirectUrlLoading(true);
    setDirectUrlError("");
    setDirectPlayUrl("");
    setDirectDanmakuUrl(undefined);

    void (async () => {
      try {
        const playUrl = await resolveDirectUrl(watchItem.handle, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setDirectPlayUrl(playUrl);

        if (danmakuHandle) {
          try {
            const danmakuUrl = await resolveDirectUrl(danmakuHandle, controller.signal);
            if (!controller.signal.aborted) {
              setDirectDanmakuUrl(danmakuUrl);
            }
          } catch {
            // Danmaku is optional; video can still play without it.
            if (!controller.signal.aborted) {
              setDirectDanmakuUrl(undefined);
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setDirectUrlError(error instanceof Error ? error.message : "无法获取直连播放地址");
      } finally {
        if (!controller.signal.aborted) {
          setDirectUrlLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [watchItem, watchDanmakuHandle, data]);

  /** External players open the CDN URL when ready; fall back to site download redirect. */

  return (
    <div className="app-shell">
      <CustomHead markup={siteSettings.customHead} />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>
            <span className="brand-mark"><HardDriveDownload size={19} strokeWidth={2.2} /></span>
            <span>{siteSettings.siteName}</span>
          </a>
          <div className="topbar-actions">
            <button className="icon-button" type="button" onClick={() => void loadDirectory(directory, true)} title="刷新目录（强制同步最新文件）" aria-label="刷新目录">
              <RefreshCw size={18} className={status === "loading" ? "spin" : ""} />
            </button>
            <button
              className="icon-button theme-toggle"
              type="button"
              onClick={toggleTheme}
              title={resolvedTheme === "dark" ? "切换浅色模式" : "切换深色模式"}
              aria-label={resolvedTheme === "dark" ? "切换浅色模式" : "切换深色模式"}
            >
              {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">

        {watchFile ? (
          <section className="watch-page" aria-label="视频播放">
            <div className="watch-topbar">
              <button className="back-button" type="button" onClick={leaveWatch}><ArrowLeft size={16} />返回目录</button>
              <span className="watch-title" title={watchItem?.name || ""}>{watchItem?.name || "视频播放"}</span>
            </div>

            <div className="watch-mode" role="group" aria-label="播放方式">
              <button type="button" className={watchMode === "player" ? "active" : ""} onClick={() => setWatchMode("player")}>视频播放器</button>
              <button type="button" className={watchMode === "download" ? "active" : ""} onClick={() => setWatchMode("download")}>下载</button>
            </div>

            {watchMode === "player" ? (
              <div className="ol-video-player">
                {status === "loading" && (
                  <div className="ol-video-status" aria-live="polite">正在读取视频信息…</div>
                )}
                {status === "ready" && !watchItem && (
                  <div className="ol-video-status ol-video-status-error" role="alert">
                    视频不存在或已失效
                    <span>请返回目录重新选择。</span>
                  </div>
                )}
                {watchItem && directUrlLoading && (
                  <div className="ol-video-status" aria-live="polite">正在获取直连地址…</div>
                )}
                {watchItem && directUrlError && !directUrlLoading && (
                  <div className="ol-video-status ol-video-status-error" role="alert">
                    {directUrlError}
                    <span>可切换到「下载」用外部播放器打开。</span>
                  </div>
                )}
                {watchItem && !directUrlLoading && directPlayUrl && (
                  <Player
                    url={directPlayUrl}
                    title={watchItem.name}
                    type={fileExtension(watchItem.name, watchItem.extension)}
                    danmakuUrl={directDanmakuUrl}
                    theme={resolvedTheme}
                    onEnded={handleVideoEnded}
                    onPrevious={watchVideoIndex > 0 ? () => playAdjacentVideo(-1) : undefined}
                    onNext={watchVideoIndex >= 0 && watchVideoIndex < directoryVideos.length - 1 ? () => playAdjacentVideo(1) : undefined}
                  />
                )}
              </div>
            ) : (
              <div className="watch-download-panel">
                {watchItem ? (
                  <>
                    <div className="watch-download-info">
                      <strong>{watchItem.name}</strong>
                      <span>{formatSize(watchItem.size)} · {formatDate(watchItem.updatedAt)} · {watchItem.extension?.toUpperCase() || "文件"}</span>
                    </div>
                    <a className="primary-button" href={downloadUrl(watchItem.handle)}><Download size={17} />下载文件</a>
                  </>
                ) : (
                  <div className="watch-error" role="alert">视频不存在或已失效，请返回目录重新选择。</div>
                )}
              </div>
            )}

            <div className="watch-below">
              <label className="ol-video-select-wrap">
                <span className="watch-below-label">当前目录视频</span>
                <select
                  className="ol-video-select"
                  value={watchItem?.handle || ""}
                  onChange={(event) => selectVideoByHandle(event.target.value)}
                  aria-label="选择当前目录视频"
                  disabled={directoryVideos.length === 0}
                >
                  {directoryVideos.map((item) => (
                    <option key={item.handle} value={item.handle}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className="ol-video-auto-next">
                <input
                  type="checkbox"
                  checked={autoNext}
                  onChange={(event) => toggleAutoNext(event.target.checked)}
                />
                <span>自动下一集</span>
              </label>
            </div>

          </section>
        ) : (
          <>
        {siteSettings.markdown.trim() && (
          <article
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(siteSettings.markdown) }}
          />
        )}

        <CustomContent markup={siteSettings.customContent} />

        <section className="workspace" aria-label="资源目录">
          <div className="toolbar">
            <div className="breadcrumbs" aria-label="当前位置">
              {pathSegments.map((item, index) => (
                <span className="breadcrumb-item" key={item.handle}>
                  {index > 0 && <ChevronRight size={15} />}
                  <button type="button" onClick={() => navigate(item.handle)} className={index === pathSegments.length - 1 ? "current" : ""}>
                    {item.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="toolbar-meta">{data ? `${data.items.length} 个项目` : "正在读取"}</div>
          </div>

          {status === "error" && (
            <div className="state-panel error-panel" role="alert">
              <AlertCircle size={24} />
              <div>
                <strong>{error}</strong>
                <p>请稍后重试，或联系站点维护者检查云盘连接配置。</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => void loadDirectory(directory, true)}>重新读取</button>
            </div>
          )}

          {status === "loading" && (
            <div className="state-panel loading-panel" aria-live="polite">
              <RefreshCw size={22} className="spin" />
              <span>正在读取资源目录</span>
            </div>
          )}

          {status === "ready" && data && (
            <>
              <div className="resource-list" role="list">
                <div className="resource-row resource-list-head" role="row">
                  <button
                    type="button"
                    className={sortHeaderClass("name")}
                    onClick={() => toggleSort("name")}
                    aria-label={sortState.orderBy === "name" ? (sortState.reverse ? "按名称降序，点击切换升序" : "按名称升序，点击切换降序") : "按名称排序"}
                  >
                    <span>名称</span>
                    {sortIndicator("name")}
                  </button>
                  <button
                    type="button"
                    className={`${sortHeaderClass("size")} resource-size`}
                    onClick={() => toggleSort("size")}
                    aria-label={sortState.orderBy === "size" ? (sortState.reverse ? "按大小降序，点击切换升序" : "按大小升序，点击切换降序") : "按大小排序"}
                  >
                    <span>大小</span>
                    {sortIndicator("size")}
                  </button>
                  <button
                    type="button"
                    className={`${sortHeaderClass("modified")} resource-date`}
                    onClick={() => toggleSort("modified")}
                    aria-label={sortState.orderBy === "modified" ? (sortState.reverse ? "按修改时间降序，点击切换升序" : "按修改时间升序，点击切换降序") : "按修改时间排序"}
                  >
                    <span>修改时间</span>
                    {sortIndicator("modified")}
                  </button>
                  <span className="head-action-spacer" aria-hidden="true" />
                </div>
                {sortedItems.map((item) => {
                  const itemIcon = iconFor(item);
                  const IconComponent = itemIcon.icon;
                  const folderPath = directory === "/" ? `/${item.name}` : `${directory}/${item.name}`;
                  return (
                    <div className={`resource-row ${selected?.handle === item.handle ? "selected" : ""}`} key={item.handle} role="listitem">
                      <button className="resource-main" type="button" onClick={() => {
                          if (item.kind === "folder") {
                            navigate(folderPath);
                          } else if (isVideoFile(item.extension, item.name)) {
                            navigateWatch(item.handle);
                          } else {
                            setSelected(item);
                          }
                        }}>
                        <span className={`resource-icon ${itemIcon.className}`}>
                          <IconComponent size={20} />
                        </span>
                        <span className="resource-name">{item.name}</span>
                      </button>
                      <span className="resource-size">{formatSize(item.size)}</span>
                      <span className="resource-date">{formatDate(item.updatedAt)}</span>
                      {item.kind === "folder" ? (
                        <button className="row-arrow" type="button" onClick={() => navigate(folderPath)} title={`打开 ${item.name}`} aria-label={`打开 ${item.name}`}>
                          <ChevronRight size={18} />
                        </button>
                      ) : (
                        <span aria-hidden="true" />
                      )}
                    </div>
                  );
                })}
              </div>
              {sortedItems.length === 0 && (
                <div className="state-panel empty-panel">
                  <Folder size={23} />
                  <div>
                    <strong>这里还没有资源</strong>
                    <p>该目录暂时为空。</p>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {selected && !selectedIsVideo && (
          <aside className="detail-panel" aria-label="资源详情">
            <div className="detail-icon">{selectedIcon && <selectedIcon.icon size={25} />}</div>
            <div className="detail-content">
              <p className="eyebrow">FILE DETAILS</p>
              <h2>{selected.name}</h2>
              <div className="detail-meta">
                <span>{formatSize(selected.size)}</span>
                <span>{formatDate(selected.updatedAt)}</span>
                <span>{selected.extension?.toUpperCase() || "文件"}</span>
              </div>
            </div>
            <a className="primary-button" href={downloadUrl(selected.handle)}><Download size={17} />下载文件</a>
            <button className="close-button" type="button" onClick={() => setSelected(null)} title="关闭详情" aria-label="关闭详情"><X size={18} /></button>
          </aside>
        )}

        <div className="bottom-actions">
          <button className="back-button" type="button" onClick={goBack} disabled={directory === "/"}><ArrowLeft size={16} />返回上级</button>
        </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
