import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  File,
  Folder,
  HardDriveDownload,
  Home,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Wifi,
} from "lucide-react";

interface ApiErrorPayload {
  error?: string;
  code?: string;
}

interface SessionInfo {
  csrfToken: string;
  expiresAt: number;
}

interface ProviderStatus {
  usernameMasked?: string;
  usernameConfigured: boolean;
  passwordConfigured: boolean;
  mailCookiesConfigured: boolean;
  authorizationConfigured: boolean;
  authorizationAccount?: string;
  authorizationExpiresAt?: number;
  authorizationExpired?: boolean;
  type: string;
  rootId: string;
  updatedAt?: number;
}

interface ResourceItem {
  handle: string;
  kind: "folder" | "file";
  name: string;
  size: number;
  updatedAt?: string;
  extension?: string;
  hidden: boolean;
  displayRoot: boolean;
}

interface ResourceDirectory {
  current: {
    name: string;
    handle: string;
    parentHandle?: string;
    parentName?: string;
  };
  items: ResourceItem[];
  rulesVersion: number;
  displayRoot: {
    configured: boolean;
    name: string;
  };
  displayRootVersion: number;
}

interface TrailItem {
  handle: string;
  name: string;
}

class SessionExpiredError extends Error {}

function formatDate(value?: string | number): string {
  if (value === undefined) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
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

function errorText(payload: ApiErrorPayload | null, fallback = "操作失败，请稍后重试。"): string {
  if (payload?.code === "admin_unauthorized") {
    return "后台会话已失效，请重新登录。";
  }
  return payload?.error || fallback;
}

async function responsePayload<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null) as Promise<T | null>;
}

function AdminLogin({ onLoggedIn }: { onLoggedIn: (session: SessionInfo) => void }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await responsePayload<SessionInfo & ApiErrorPayload>(response);
      if (!response.ok || !payload?.csrfToken || !payload.expiresAt) {
        throw new Error(errorText(payload));
      }
      setPassword("");
      onLoggedIn({ csrfToken: payload.csrfToken, expiresAt: payload.expiresAt });
    } catch (requestError) {
      setStatus("error");
      setError(requestError instanceof Error ? requestError.message : "登录失败，请重试。");
    }
  }

  return (
    <div className="admin-shell admin-login-shell">
      <main className="admin-login-panel">
        <div className="admin-login-mark"><HardDriveDownload size={25} /></div>
        <p className="admin-kicker">PRIVATE ADMIN</p>
        <h1>后台登录</h1>
        <p className="admin-muted">资源分发站管理入口</p>
        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">
            <span>管理员密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required />
          </label>
          {error && <div className="admin-alert error" role="alert"><AlertCircle size={17} />{error}</div>}
          <button className="admin-button primary wide" type="submit" disabled={status === "loading"}>
            {status === "loading" ? <RefreshCw size={17} className="spin" /> : <LogIn size={17} />}
            登录后台
          </button>
        </form>
      </main>
    </div>
  );
}

function AdminApp() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "login" | "ready">("loading");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerValues, setProviderValues] = useState({ username: "", authorization: "", password: "", mailCookies: "", type: "personal_new", rootId: "/" });
  const [clearFields, setClearFields] = useState({ username: false, authorization: false, password: false, mailCookies: false });
  const [providerBusy, setProviderBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordValues, setPasswordValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [resourceDirectory, setResourceDirectory] = useState<ResourceDirectory | null>(null);
  const [resourceTrail, setResourceTrail] = useState<TrailItem[]>([{ handle: "root", name: "资源根目录" }]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceToggling, setResourceToggling] = useState<string | null>(null);
  const [displayRootBusy, setDisplayRootBusy] = useState(false);

  const showNotice = useCallback((kind: "success" | "error", text: string) => {
    setNotice({ kind, text });
  }, []);

  const expireSession = useCallback(() => {
    setSession(null);
    setAuthStatus("login");
    setProvider(null);
    setResourceDirectory(null);
    showNotice("error", "后台会话已失效，请重新登录。");
  }, [showNotice]);

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const method = (init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (session && method !== "GET") {
      headers.set("X-CSRF-Token", session.csrfToken);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(path, { ...init, headers });
    const payload = await responsePayload<T & ApiErrorPayload>(response);
    if (response.status === 401) {
      expireSession();
      throw new SessionExpiredError("后台会话已失效，请重新登录。");
    }
    if (!response.ok) {
      throw new Error(errorText(payload));
    }
    return payload as T;
  }, [expireSession, session]);

  const loadProvider = useCallback(async () => {
    const payload = await request<ProviderStatus>("/api/admin/provider");
    setProvider(payload);
    setProviderValues((previous) => ({ ...previous, type: payload.type, rootId: payload.rootId }));
  }, [request]);

  const loadResources = useCallback(async (handle: string) => {
    setResourceBusy(true);
    try {
      const payload = await request<ResourceDirectory>(`/api/admin/resources?dir=${encodeURIComponent(handle)}`);
      setResourceDirectory(payload);
      setResourceTrail((previous) => {
        if (handle === "root") {
          return [{ handle: "root", name: "资源根目录" }];
        }
        const existingIndex = previous.findIndex((item) => item.handle === payload.current.handle);
        if (existingIndex >= 0) {
          return [...previous.slice(0, existingIndex), { handle: payload.current.handle, name: payload.current.name }];
        }
        return [...previous, { handle: payload.current.handle, name: payload.current.name }];
      });
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "资源目录读取失败。");
      }
    } finally {
      setResourceBusy(false);
    }
  }, [request, showNotice]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/session", { headers: { Accept: "application/json" } })
      .then(async (response) => ({ response, payload: await responsePayload<SessionInfo & ApiErrorPayload>(response) }))
      .then(({ response, payload }) => {
        if (!active) {
          return;
        }
        if (response.ok && payload?.csrfToken && payload.expiresAt) {
          setSession({ csrfToken: payload.csrfToken, expiresAt: payload.expiresAt });
          setAuthStatus("ready");
        } else {
          setAuthStatus("login");
        }
      })
      .catch(() => {
        if (active) {
          setAuthStatus("login");
          showNotice("error", "后台连接失败，请检查站点状态。");
        }
      });
    return () => { active = false; };
  }, [showNotice]);

  useEffect(() => {
    if (authStatus !== "ready" || !session) {
      return;
    }
    void Promise.all([loadProvider(), loadResources("root")]).catch((error) => {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "后台数据读取失败。");
      }
    });
  }, [authStatus, loadProvider, loadResources, session, showNotice]);

  async function loginComplete(nextSession: SessionInfo) {
    setSession(nextSession);
    setAuthStatus("ready");
    setNotice(null);
  }

  async function logout() {
    try {
      await request<{ authenticated: false }>("/api/admin/session", { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "退出失败。");
      }
    } finally {
      setSession(null);
      setAuthStatus("login");
      setProvider(null);
      setResourceDirectory(null);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordValues.newPassword !== passwordValues.confirmPassword) {
      showNotice("error", "两次输入的新密码不一致。");
      return;
    }
    setPasswordBusy(true);
    try {
      const payload = await request<SessionInfo>("/api/admin/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: passwordValues.currentPassword, newPassword: passwordValues.newPassword }),
      });
      setSession({ csrfToken: payload.csrfToken, expiresAt: payload.expiresAt });
      setPasswordValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showNotice("success", "管理员密码已更新。");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "密码更新失败。");
      }
    } finally {
      setPasswordBusy(false);
    }
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    const patch: Record<string, string | null> = { type: providerValues.type, rootId: providerValues.rootId };
    for (const field of ["username", "authorization", "password", "mailCookies"] as const) {
      if (clearFields[field]) {
        patch[field] = null;
      } else if (providerValues[field]) {
        patch[field] = providerValues[field];
      }
    }
    setProviderBusy("save");
    try {
      const payload = await request<{ provider: ProviderStatus }>("/api/admin/provider", { method: "PATCH", body: JSON.stringify(patch) });
      setProvider(payload.provider);
      setProviderValues((previous) => ({ ...previous, username: "", authorization: "", password: "", mailCookies: "" }));
      setClearFields({ username: false, authorization: false, password: false, mailCookies: false });
      showNotice("success", "云盘配置已保存，旧云盘会话已清除。");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "云盘配置保存失败。");
      }
    } finally {
      setProviderBusy(null);
    }
  }

  async function clearProvider() {
    setProviderBusy("clear");
    try {
      const payload = await request<{ provider: ProviderStatus }>("/api/admin/provider", {
        method: "PATCH",
        body: JSON.stringify({ username: null, authorization: null, password: null, mailCookies: null }),
      });
      setProvider(payload.provider);
      setProviderValues((previous) => ({ ...previous, username: "", authorization: "", password: "", mailCookies: "" }));
      showNotice("success", "已清空保存的云盘凭据。");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "凭据清空失败。");
      }
    } finally {
      setProviderBusy(null);
    }
  }

  async function testProvider() {
    setProviderBusy("test");
    try {
      const result = await request<{ ok: boolean; account?: string; expiresAt?: number }>("/api/admin/provider/test", { method: "POST", body: "{}" });
      showNotice("success", `云盘连接成功${result.account ? `，账号 ${result.account}` : ""}。`);
      await loadProvider();
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "云盘连接测试失败。");
      }
    } finally {
      setProviderBusy(null);
    }
  }

  async function toggleResource(item: ResourceItem) {
    setResourceToggling(item.handle);
    try {
      const nextHidden = !item.hidden;
      await request("/api/admin/resources", { method: "PATCH", body: JSON.stringify({ resourceHandle: item.handle, hidden: nextHidden }) });
      setResourceDirectory((current) => current ? { ...current, items: current.items.map((value) => value.handle === item.handle ? { ...value, hidden: nextHidden } : value) } : current);
      showNotice("success", nextHidden ? `已隐藏“${item.name}”。` : `已恢复显示“${item.name}”。`);
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "资源状态更新失败。");
      }
    } finally {
      setResourceToggling(null);
    }
  }

  async function setDisplayRoot(item: ResourceItem | null) {
    setDisplayRootBusy(true);
    try {
      const payload = await request<{ displayRoot: ResourceDirectory["displayRoot"] }>("/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify(item ? { resourceHandle: item.handle, displayRoot: true } : { displayRoot: false }),
      });
      setResourceDirectory((current) => current ? {
        ...current,
        displayRoot: payload.displayRoot,
        items: current.items.map((value) => ({ ...value, displayRoot: item ? value.handle === item.handle : false })),
      } : current);
      showNotice("success", item ? `已将“${item.name}”设为公开展示根目录。` : "已恢复使用云盘根目录作为公开展示根目录。");
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        showNotice("error", error instanceof Error ? error.message : "展示根目录更新失败。");
      }
    } finally {
      setDisplayRootBusy(false);
    }
  }

  const sortedResources = useMemo(() => [...(resourceDirectory?.items || [])].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  }), [resourceDirectory]);

  if (authStatus === "loading") {
    return <div className="admin-shell admin-loading"><RefreshCw size={23} className="spin" />正在检查后台会话</div>;
  }
  if (authStatus === "login" || !session) {
    return <AdminLogin onLoggedIn={loginComplete} />;
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <div className="admin-brand"><span className="admin-brand-mark"><HardDriveDownload size={18} /></span><span>资源分发站 / 后台</span></div>
          <div className="admin-top-actions"><span className="admin-session-state"><span className="status-dot" />已登录</span><button className="admin-icon-button" type="button" onClick={() => void logout()} title="退出登录" aria-label="退出登录"><LogOut size={18} /></button></div>
        </div>
      </header>
      <main className="admin-main">
        {notice && <div className={`admin-alert ${notice.kind}`} role="status">{notice.kind === "success" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{notice.text}</span><button className="admin-alert-close" type="button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
        <section className="admin-heading-band">
          <div><p className="admin-kicker">CONTROL ROOM</p><h1>后台管理</h1><p className="admin-muted">配置云盘连接，并控制公开资源的显示状态。</p></div>
          <div className="admin-heading-meta"><ShieldCheck size={20} /><span>会话至 {formatDate(session.expiresAt)}</span></div>
        </section>

        <section className="admin-section" aria-labelledby="security-heading">
          <div className="admin-section-heading"><div className="admin-section-icon"><KeyRound size={19} /></div><div><p className="admin-kicker">ACCOUNT SECURITY</p><h2 id="security-heading">账号安全</h2></div></div>
          <div className="admin-two-column">
            <div className="admin-status-block"><div className="admin-status-label"><UserRound size={17} />当前账号</div><strong>admin</strong><span className="admin-muted">单管理员模式</span><div className="admin-status-line"><ShieldCheck size={15} />密码已配置</div></div>
            <form className="admin-form admin-compact-form" onSubmit={savePassword}><h3>修改密码</h3><div className="admin-form-grid"><label className="admin-field"><span>当前密码</span><input type="password" value={passwordValues.currentPassword} onChange={(event) => setPasswordValues((value) => ({ ...value, currentPassword: event.target.value }))} autoComplete="current-password" required /></label><label className="admin-field"><span>新密码</span><input type="password" value={passwordValues.newPassword} onChange={(event) => setPasswordValues((value) => ({ ...value, newPassword: event.target.value }))} autoComplete="new-password" minLength={8} required /></label><label className="admin-field"><span>确认新密码</span><input type="password" value={passwordValues.confirmPassword} onChange={(event) => setPasswordValues((value) => ({ ...value, confirmPassword: event.target.value }))} autoComplete="new-password" minLength={8} required /></label></div><button className="admin-button primary" type="submit" disabled={passwordBusy}>{passwordBusy ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}保存新密码</button></form>
          </div>
        </section>

        <section className="admin-section" aria-labelledby="provider-heading">
          <div className="admin-section-heading"><div className="admin-section-icon provider"><Server size={19} /></div><div><p className="admin-kicker">139 CLOUD CONNECTION</p><h2 id="provider-heading">139 云盘账号</h2></div><div className="admin-heading-actions"><button className="admin-button secondary" type="button" onClick={() => void testProvider()} disabled={providerBusy !== null}><Wifi size={16} />连接测试</button></div></div>
          <div className="admin-provider-status">{provider ? <><span className={provider.authorizationConfigured ? "admin-badge configured" : "admin-badge"}>{provider.authorizationConfigured ? "Authorization 已配置" : "Authorization 未配置"}</span><span className={provider.mailCookiesConfigured ? "admin-badge configured" : "admin-badge"}>{provider.mailCookiesConfigured ? "MailCookies 已配置" : "MailCookies 未配置"}</span><span className="admin-badge">账号 {provider.usernameMasked || "未配置"}</span>{provider.authorizationExpired && <span className="admin-badge warning">Authorization 已过期</span>}</> : <span className="admin-muted">正在读取配置状态</span>}</div>
          <form className="admin-form" onSubmit={saveProvider}><div className="admin-form-grid provider-grid"><label className="admin-field"><span>用户名</span><input value={providerValues.username} onChange={(event) => setProviderValues((value) => ({ ...value, username: event.target.value }))} placeholder={provider?.usernameConfigured ? "已配置，输入新值覆盖" : "输入 139 用户名"} autoComplete="off" /></label><label className="admin-field"><span>账号类型</span><select value={providerValues.type} onChange={(event) => setProviderValues((value) => ({ ...value, type: event.target.value }))}><option value="personal_new">个人云</option><option value="family">家庭云</option></select></label><label className="admin-field"><span>根目录 ID</span><input value={providerValues.rootId} onChange={(event) => setProviderValues((value) => ({ ...value, rootId: event.target.value }))} /></label><label className="admin-field wide-field"><span>Authorization</span><input value={providerValues.authorization} onChange={(event) => setProviderValues((value) => ({ ...value, authorization: event.target.value }))} placeholder={provider?.authorizationConfigured ? "已配置，留空保持不变" : "粘贴 Authorization"} autoComplete="off" /></label><label className="admin-field"><span>密码</span><input type="password" value={providerValues.password} onChange={(event) => setProviderValues((value) => ({ ...value, password: event.target.value }))} placeholder={provider?.passwordConfigured ? "已配置，留空保持不变" : "输入云盘密码"} autoComplete="new-password" /></label><label className="admin-field wide-field"><span>MailCookies</span><textarea value={providerValues.mailCookies} onChange={(event) => setProviderValues((value) => ({ ...value, mailCookies: event.target.value }))} placeholder={provider?.mailCookiesConfigured ? "已配置，留空保持不变" : "粘贴 MailCookies"} rows={3} autoComplete="off" /></label></div><div className="admin-secret-clear-row">{(["username", "authorization", "password", "mailCookies"] as const).map((field) => <label className="admin-check" key={field}><input type="checkbox" checked={clearFields[field]} onChange={(event) => setClearFields((value) => ({ ...value, [field]: event.target.checked }))} />清空{field === "username" ? "用户名" : field === "authorization" ? "Authorization" : field === "password" ? "密码" : "MailCookies"}</label>)}</div><div className="admin-form-actions"><button className="admin-button primary" type="submit" disabled={providerBusy !== null}>{providerBusy === "save" ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}保存云盘配置</button><button className="admin-button danger" type="button" onClick={() => void clearProvider()} disabled={providerBusy !== null}><Trash2 size={16} />清空全部凭据</button></div></form>
        </section>

        <section className="admin-section resources-section" aria-labelledby="resources-heading">
          <div className="admin-section-heading"><div className="admin-section-icon resource"><Folder size={19} /></div><div><p className="admin-kicker">PUBLIC VISIBILITY</p><h2 id="resources-heading">资源显示管理</h2></div><button className="admin-icon-button section-refresh" type="button" onClick={() => void loadResources(resourceDirectory?.current.handle || "root")} disabled={resourceBusy} title="刷新资源目录" aria-label="刷新资源目录"><RefreshCw size={18} className={resourceBusy ? "spin" : ""} /></button></div>
          <div className="admin-resource-toolbar"><div className="admin-breadcrumbs">{resourceTrail.map((item, index) => <span key={item.handle} className="admin-breadcrumb"><button type="button" className={index === resourceTrail.length - 1 ? "current" : ""} onClick={() => void loadResources(item.handle)}>{item.name}</button>{index < resourceTrail.length - 1 && <ChevronRight size={15} />}</span>)}</div><div className="admin-resource-toolbar-actions"><span className="admin-root-status"><Home size={14} />公开根目录：{resourceDirectory?.displayRoot.name || "资源根目录"}</span>{resourceDirectory?.displayRoot.configured && <button className="admin-button secondary admin-reset-root" type="button" onClick={() => void setDisplayRoot(null)} disabled={displayRootBusy}><Home size={15} />恢复云盘根目录</button>}<span className="admin-muted">规则版本 {resourceDirectory?.rulesVersion ?? "-"}</span></div></div>
          {resourceBusy && !resourceDirectory && <div className="admin-empty"><RefreshCw size={21} className="spin" />正在读取资源目录</div>}
          {!resourceBusy && resourceDirectory && <div className="admin-resource-list">{sortedResources.map((item) => <div className={`admin-resource-row ${item.hidden ? "is-hidden" : ""}`} key={item.handle}><span className={`admin-resource-icon ${item.kind}`}>{item.kind === "folder" ? <Folder size={18} /> : <File size={18} />}</span>{item.kind === "folder" ? <button className="admin-resource-name admin-resource-name-button" type="button" onClick={() => void loadResources(item.handle)} title={`打开 ${item.name}`}>{item.name}<ChevronRight size={15} />{item.displayRoot && <span className="admin-root-marker">展示根</span>}</button> : <span className="admin-resource-name">{item.name}</span>}<span className="admin-resource-type">{item.kind === "folder" ? "文件夹" : item.extension?.toUpperCase() || "文件"}</span><span className="admin-resource-size">{formatSize(item.size)}</span><span className={item.hidden ? "admin-visibility hidden" : "admin-visibility"}>{item.hidden ? <><EyeOff size={15} />隐藏</> : <><Eye size={15} />显示</>}</span>{item.kind === "folder" ? <button className={`admin-root-button ${item.displayRoot ? "active" : ""}`} type="button" onClick={() => void setDisplayRoot(item.displayRoot ? null : item)} disabled={displayRootBusy} title={item.displayRoot ? "取消展示根目录" : "设为展示根目录"} aria-label={`${item.displayRoot ? "取消展示根目录" : "设为展示根目录"} ${item.name}`}>{displayRootBusy ? <RefreshCw size={15} className="spin" /> : <Home size={15} />}</button> : <span className="admin-root-spacer" />}<button className="admin-visibility-button" type="button" onClick={() => void toggleResource(item)} disabled={resourceToggling === item.handle} title={item.hidden ? "恢复显示" : "隐藏资源"} aria-label={`${item.hidden ? "恢复显示" : "隐藏"} ${item.name}`}>{resourceToggling === item.handle ? <RefreshCw size={16} className="spin" /> : item.hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button></div>)}{sortedResources.length === 0 && <div className="admin-empty"><Folder size={21} />当前目录为空</div>}</div>}
          <div className="admin-resource-footer"><button className="admin-button secondary" type="button" onClick={() => resourceDirectory?.current.parentHandle && void loadResources(resourceDirectory.current.parentHandle)} disabled={!resourceDirectory?.current.parentHandle || resourceBusy}><ChevronRight size={16} className="rotate-left" />返回上级</button><span className="admin-muted">隐藏资源仍保留在后台目录中</span></div>
        </section>
      </main>
    </div>
  );
}

export default AdminApp;
