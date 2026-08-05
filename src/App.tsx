import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Download,
  File,
  Folder,
  HardDriveDownload,
  Moon,
  RefreshCw,
  Sun,
  X,
} from "lucide-react";
import { defaultSiteSettings, normalizeSiteSettings, renderMarkdown, SiteSettings, ThemeMode } from "./site-settings";

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

const THEME_OVERRIDE_KEY = "resource-hub-theme";

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
  return new URLSearchParams(window.location.search).get("dir") || "root";
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
  const [trail, setTrail] = useState<TrailItem[]>([{ handle: "root", name: "资源根目录" }]);
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("暂时无法读取资源目录。");
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const [themeOverride, setThemeOverride] = useState<ResolvedTheme | null>(readThemeOverride);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);
  const resolvedTheme = resolveTheme(siteSettings.themeMode, systemTheme, themeOverride);

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
    document.title = siteSettings.siteName;
  }, [siteSettings.siteName]);

  const loadDirectory = useCallback(async (handle: string) => {
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
      const response = await fetch(`/api/resources?dir=${encodeURIComponent(handle)}`, {
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
      setTrail((previous) => {
        if (handle === "root") {
          setRootName(payload.current.name);
          return [{ handle: "root", name: payload.current.name }];
        }
        const existingIndex = previous.findIndex((item) => item.handle === payload.current.handle);
        if (existingIndex >= 0) {
          return [...previous.slice(0, existingIndex), { handle: payload.current.handle, name: payload.current.name }];
        }
        return [...previous, { handle: payload.current.handle, name: payload.current.name }];
      });
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
      if (nextDirectory === "root") {
        setTrail([{ handle: "root", name: rootName }]);
      }
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

  const currentTrail = useMemo(() => {
    if (directory === "root") {
      return [{ handle: "root", name: rootName }];
    }
    return trail;
  }, [directory, rootName, trail]);

  function navigate(handle: string, name?: string) {
    const url = new URL(window.location.href);
    if (handle === "root") {
      url.searchParams.delete("dir");
      setTrail([{ handle: "root", name: rootName }]);
    } else {
      url.searchParams.set("dir", handle);
      setTrail((previous) => {
        const existingIndex = previous.findIndex((item) => item.handle === handle);
        if (existingIndex >= 0) {
          return previous.slice(0, existingIndex + 1);
        }
        return [...previous, { handle, name: name || "当前目录" }];
      });
    }
    window.history.pushState({}, "", url);
    setDirectory(handle);
  }

  function goBack() {
    const parentHandle = data?.current.parentHandle;
    if (!parentHandle) {
      return;
    }
    if (parentHandle === "root") {
      navigate("root");
      return;
    }
    const parent = currentTrail.find((item) => item.handle === parentHandle);
    if (parent) {
      navigate(parent.handle, parent.name);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("dir", parentHandle);
    window.history.pushState({}, "", url);
    setTrail([{ handle: "root", name: "资源根目录" }, { handle: parentHandle, name: data?.current.parentName || "上一级目录" }]);
    setDirectory(parentHandle);
  }

  const sortedItems = useMemo(() => {
    if (!data) {
      return [];
    }
    return [...data.items].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
  }, [data]);

  return (
    <div className="app-shell">
      <CustomHead markup={siteSettings.customHead} />
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("root"); }}>
            <span className="brand-mark"><HardDriveDownload size={19} strokeWidth={2.2} /></span>
            <span>{siteSettings.siteName}</span>
          </a>
          <div className="topbar-actions">
            <div className="topbar-status"><span className="status-dot" />在线资源</div>
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
        <section className="intro-band">
          <div>
            <p className="eyebrow">RESOURCE LIBRARY</p>
            <h1>{siteSettings.headerTitle}</h1>
            <p className="intro-copy">{siteSettings.headerSubtitle}</p>
          </div>
          <button className="icon-button" type="button" onClick={() => void loadDirectory(directory)} title="刷新目录" aria-label="刷新目录">
            <RefreshCw size={18} className={status === "loading" ? "spin" : ""} />
          </button>
        </section>

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
              {currentTrail.map((item, index) => (
                <span className="breadcrumb-item" key={item.handle}>
                  {index > 0 && <ChevronRight size={15} />}
                  <button type="button" onClick={() => navigate(item.handle, item.name)} className={index === currentTrail.length - 1 ? "current" : ""}>
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
              <button className="secondary-button" type="button" onClick={() => void loadDirectory(directory)}>重新读取</button>
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
                {sortedItems.map((item) => (
                  <div className={`resource-row ${selected?.handle === item.handle ? "selected" : ""}`} key={item.handle} role="listitem">
                    <button className="resource-main" type="button" onClick={() => item.kind === "folder" ? navigate(item.handle, item.name) : setSelected(item)}>
                      <span className={`resource-icon ${item.kind}`}>
                        {item.kind === "folder" ? <Folder size={20} /> : <File size={20} />}
                      </span>
                      <span className="resource-name">{item.name}</span>
                    </button>
                    <span className="resource-kind">{item.kind === "folder" ? "文件夹" : item.extension?.toUpperCase() || "文件"}</span>
                    <span className="resource-size">{formatSize(item.size)}</span>
                    <span className="resource-date">{formatDate(item.updatedAt)}</span>
                    {item.kind === "file" ? (
                      <a className="download-button" href={downloadUrl(item.handle)} title={`下载 ${item.name}`} aria-label={`下载 ${item.name}`}>
                        <Download size={17} />
                        <span>下载</span>
                      </a>
                    ) : (
                      <button className="row-arrow" type="button" onClick={() => navigate(item.handle, item.name)} title={`打开 ${item.name}`} aria-label={`打开 ${item.name}`}>
                        <ChevronRight size={18} />
                      </button>
                    )}
                  </div>
                ))}
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

        {selected && (
          <aside className="detail-panel" aria-label="资源详情">
            <div className="detail-icon"><File size={25} /></div>
            <div className="detail-content">
              <p className="eyebrow">FILE DETAILS</p>
              <h2>{selected.name}</h2>
              <div className="detail-meta"><span>{formatSize(selected.size)}</span><span>{formatDate(selected.updatedAt)}</span><span>{selected.extension?.toUpperCase() || "文件"}</span></div>
            </div>
            <a className="primary-button" href={downloadUrl(selected.handle)}><Download size={17} />下载文件</a>
            <button className="close-button" type="button" onClick={() => setSelected(null)} title="关闭详情" aria-label="关闭详情"><X size={18} /></button>
          </aside>
        )}

        <div className="bottom-actions">
          <button className="back-button" type="button" onClick={goBack} disabled={!data?.current.parentHandle}><ArrowLeft size={16} />返回上级</button>
          <span>目录内容实时同步，下载链接按需生成</span>
        </div>
      </main>
    </div>
  );
}

export default App;
