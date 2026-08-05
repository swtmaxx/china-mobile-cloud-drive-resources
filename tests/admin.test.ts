import { describe, expect, it, vi } from "vitest";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "../lib/env";
import { onRequestDelete, onRequestGet as getSession, onRequestPost as postSession } from "../functions/api/admin/session";
import { onRequestPatch as patchProvider, onRequestGet as getProvider } from "../functions/api/admin/provider";
import { onRequestPost as changePassword } from "../functions/api/admin/account/password";
import { readAdminJson, ADMIN_PASSWORD_KEY, ADMIN_PROVIDER_KEY } from "../lib/admin/storage";
import { encryptSecret } from "../lib/security/secrets";
import { onRequestGet as getPublicDirectory } from "../functions/api/resources";
import { onRequestGet as getDownload } from "../functions/api/download";
import { onRequestGet as getAdminResources, onRequestPatch as patchAdminResources } from "../functions/api/admin/resources";
import { onRequestGet as getAdminSiteSettings, onRequestPatch as patchAdminSiteSettings } from "../functions/api/admin/site-settings";
import { onRequestGet as getSiteSettings } from "../functions/api/site-settings";
import { createResourceHandle, verifyResourceHandle } from "../lib/security/handles";
import { readResourceRules, updateResourceRule } from "../lib/resource-rules";
import { isResourceVisible, publicCacheKey } from "../lib/resources";
import { readDisplayRoot } from "../lib/display-root";
import { ADMIN_DISPLAY_ROOT_KEY, ADMIN_SITE_SETTINGS_KEY, DISPLAY_ROOT_VERSION_KEY } from "../lib/admin/storage";

const KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const AUTHORIZATION = btoa("pc:13800138000:token|x|y|1890000000");
const MAIL_COOKIES = "RMKEY=private-cookie; Os_SSo_Sid=private-sid";

function makeKv() {
  const values = new Map<string, string>();
  const kv = {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => { values.set(key, value); },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as KVNamespace;
  return { kv, values };
}

function envWith(kv: KVNamespace): Env {
  return {
    RESOURCE_KV: kv,
    ADMIN_PASSWORD: "initial-admin-password",
    ADMIN_SESSION_KEY: KEY_A,
    ADMIN_DATA_KEY: KEY_B,
    RESOURCE_HANDLE_KEY: KEY_A,
    AUTH_ENCRYPTION_KEY: KEY_B,
    YUN139_USERNAME: "13800138000",
    YUN139_PASSWORD: "provider-password",
    YUN139_MAIL_COOKIES: MAIL_COOKIES,
    YUN139_AUTHORIZATION: AUTHORIZATION,
    YUN139_TYPE: "personal_new",
    YUN139_ROOT_ID: "/",
  };
}

function cookieFrom(response: Response): string {
  return response.headers.get("Set-Cookie")?.split(";")[0] || "";
}

function context(request: Request, env: Env) {
  return { request, env };
}

describe("admin session and provider APIs", () => {
  it("rejects unauthenticated and expired sessions", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);
    expect((await getProvider(context(new Request("https://example.test/api/admin/provider"), env))).status).toBe(401);
    const expired = await encryptSecret(JSON.stringify({ version: 1, sessionVersion: 1, csrfToken: "expired-csrf-token-value-123456", issuedAt: Date.now() - 10_000, expiresAt: Date.now() - 1 }), env.ADMIN_SESSION_KEY!, "ADMIN_SESSION_KEY");
    const response = await getSession(context(new Request("https://example.test/api/admin/session", { headers: { Cookie: `admin_session=${expired}` } }), env));
    expect(response.status).toBe(401);
  });

  it("uses encrypted sessions, CSRF protection, masked provider status and password rotation", async () => {
    const { kv, values } = makeKv();
    const env = envWith(kv);
    const url = "https://example.test/api/admin/session";

    const wrong = await postSession(context(new Request(url, { method: "POST", body: JSON.stringify({ password: "wrong-password" }), headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" } }), env));
    expect(wrong.status).toBe(401);

    const loggedIn = await postSession(context(new Request(url, { method: "POST", body: JSON.stringify({ password: env.ADMIN_PASSWORD }), headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" } }), env));
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(loggedIn.headers.get("Set-Cookie")).toContain("Secure");
    expect(loggedIn.headers.get("Set-Cookie")).toContain("SameSite=Lax");
    expect(values.has(ADMIN_PASSWORD_KEY)).toBe(false);
    const cookie = cookieFrom(loggedIn);
    const sessionPayload = await loggedIn.json() as { csrfToken: string };
    expect(sessionPayload.csrfToken).toBeTruthy();

    const current = await getSession(context(new Request(url, { headers: { Cookie: cookie } }), env));
    expect(current.status).toBe(200);

    const provider = await getProvider(context(new Request("https://example.test/api/admin/provider", { headers: { Cookie: cookie } }), env));
    expect(provider.status).toBe(200);
    const providerBody = await provider.text();
    expect(providerBody).toContain("138***000");
    expect(providerBody).not.toContain("provider-password");
    expect(providerBody).not.toContain(MAIL_COOKIES);
    expect(providerBody).not.toContain(AUTHORIZATION);

    const csrfMissing = await patchProvider(context(new Request("https://example.test/api/admin/provider", { method: "PATCH", body: JSON.stringify({ username: "new-user" }), headers: { Cookie: cookie, "Content-Type": "application/json" } }), env));
    expect(csrfMissing.status).toBe(403);

    const providerUpdated = await patchProvider(context(new Request("https://example.test/api/admin/provider", { method: "PATCH", body: JSON.stringify({ username: "13900001111", password: "new-provider-password" }), headers: { Cookie: cookie, "X-CSRF-Token": sessionPayload.csrfToken, "Content-Type": "application/json" } }), env));
    expect(providerUpdated.status).toBe(200);
    const storedProvider = values.get(ADMIN_PROVIDER_KEY) || "";
    expect(storedProvider).not.toContain("new-provider-password");
    expect(storedProvider).not.toContain("13900001111");
    expect(await readAdminJson(env, ADMIN_PROVIDER_KEY)).toMatchObject({ username: "13900001111", password: "new-provider-password" });

    const passwordResponse = await changePassword(context(new Request("https://example.test/api/admin/account/password", { method: "POST", body: JSON.stringify({ currentPassword: env.ADMIN_PASSWORD, newPassword: "rotated-admin-password" }), headers: { Cookie: cookie, "X-CSRF-Token": sessionPayload.csrfToken, "Content-Type": "application/json" } }), env));
    expect(passwordResponse.status).toBe(200);
    expect(values.get(ADMIN_PASSWORD_KEY)).toMatch(/^\{"hash":"pbkdf2-sha256\$100000\$/);
    const rotatedCookie = cookieFrom(passwordResponse);
    const oldSession = await getSession(context(new Request(url, { headers: { Cookie: cookie } }), env));
    expect(oldSession.status).toBe(401);
    const newSession = await getSession(context(new Request(url, { headers: { Cookie: rotatedCookie } }), env));
    expect(newSession.status).toBe(200);

    const logoutBody = await newSession.json() as { csrfToken: string };
    const loggedOut = await onRequestDelete(context(new Request(url, { method: "DELETE", headers: { Cookie: rotatedCookie, "X-CSRF-Token": logoutBody.csrfToken } }), env));
    expect(loggedOut.status).toBe(200);
    expect((await getSession(context(new Request(url, { headers: { Cookie: rotatedCookie } }), env))).status).toBe(401);
    expect(values.has(ADMIN_PASSWORD_KEY)).toBe(true);
  });

  it("limits repeated failed login attempts", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);
    const request = () => new Request("https://example.test/api/admin/session", { method: "POST", body: JSON.stringify({ password: "wrong-password" }), headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" } });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await postSession(context(request(), env))).status).toBe(401);
    }
    const blocked = await postSession(context(request(), env));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("900");
  });
});

describe("resource visibility rules", () => {
  it("uses stable IDs, invalidates cache versions and blocks old descendant handles", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);
    const folderHandle = await createResourceHandle({ version: 2, kind: "folder", fileId: "folder-stable-id", rootId: "/", name: "Private", parentHandle: "root", expiresAt: Date.now() + 60_000 }, KEY_A);
    const fileHandle = await createResourceHandle({ version: 2, kind: "file", fileId: "file-stable-id", rootId: "/", name: "secret.pdf", parentHandle: folderHandle, parentName: "Private", expiresAt: Date.now() + 60_000 }, KEY_A);
    const filePayload = await verifyResourceHandle(fileHandle, KEY_A);
    expect(filePayload).not.toBeNull();
    const before = await readResourceRules(env);
    expect(before.version).toBe(0);
    expect(await isResourceVisible(filePayload!, env, KEY_A, before)).toBe(true);
    const version = await updateResourceRule(env, "folder-stable-id", true);
    const after = await readResourceRules(env);
    expect(version).toBe(after.version);
    expect(after.hiddenIds.has("folder-stable-id")).toBe(true);
    expect(await isResourceVisible(filePayload!, env, KEY_A, after)).toBe(false);
    expect(publicCacheKey({ id: "/", name: "资源根目录", handle: "root" }, 0, before.version)).not.toBe(publicCacheKey({ id: "/", name: "资源根目录", handle: "root" }, 0, after.version));

    const hiddenDirectory = await getPublicDirectory({ request: new Request(`https://example.test/api/resources?dir=${encodeURIComponent(folderHandle)}`), env });
    expect(hiddenDirectory.status).toBe(404);
    const hiddenDownload = await getDownload({ request: new Request(`https://example.test/api/download?resource=${encodeURIComponent(fileHandle)}`), env });
    expect(hiddenDownload.status).toBe(404);
  });

  it("restores a hidden stable ID", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);
    await updateResourceRule(env, "folder-stable-id", true);
    await updateResourceRule(env, "folder-stable-id", false);
    const rules = await readResourceRules(env);
    expect(rules.hiddenIds.has("folder-stable-id")).toBe(false);
  });

  it("keeps hidden items visible in the authenticated admin directory", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);
    const login = await postSession(context(new Request("https://example.test/api/admin/session", { method: "POST", body: JSON.stringify({ password: env.ADMIN_PASSWORD }), headers: { "Content-Type": "application/json" } }), env));
    const cookie = cookieFrom(login);
    const body = await login.json() as { csrfToken: string };
    const folderHandle = await createResourceHandle({ version: 2, kind: "folder", fileId: "folder-admin-id", rootId: "/", name: "Hidden Folder", parentHandle: "root", expiresAt: Date.now() + 60_000 }, KEY_A);
    await updateResourceRule(env, "folder-admin-id", true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("qryRoutePolicy")) {
        return new Response(JSON.stringify({ success: true, data: { routePolicyList: [{ modName: "personal", httpsUrl: "https://personal.example" }] } }));
      }
      return new Response(JSON.stringify({ success: true, data: { items: [{ fileId: "folder-admin-id", name: "Hidden Folder", type: "folder" }], nextPageCursor: "" } }));
    });
    try {
      const response = await getAdminResources({ request: new Request("https://example.test/api/admin/resources?dir=root", { headers: { Cookie: cookie } }), env });
      expect(response.status).toBe(200);
      const payload = await response.json() as { items: Array<{ name: string; hidden: boolean }> };
      expect(payload.items).toEqual([expect.objectContaining({ name: "Hidden Folder", hidden: true })]);
      expect(body.csrfToken).toBeTruthy();
      expect(folderHandle).toContain("v2.");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("uses a selected folder as the public display root and invalidates old scoped handles", async () => {
    const { kv, values } = makeKv();
    const env = envWith(kv);
    const login = await postSession(context(new Request("https://example.test/api/admin/session", { method: "POST", body: JSON.stringify({ password: env.ADMIN_PASSWORD }), headers: { "Content-Type": "application/json" } }), env));
    const cookie = cookieFrom(login);
    const loginBody = await login.json() as { csrfToken: string };
    const displayRootHandle = await createResourceHandle({ version: 2, kind: "folder", fileId: "display-root-id", rootId: "/", name: "公开目录", parentHandle: "root", scopeRootId: "/", expiresAt: Date.now() + 60_000 }, KEY_A);
    const secondRootHandle = await createResourceHandle({ version: 2, kind: "folder", fileId: "second-root-id", rootId: "/", name: "第二个目录", parentHandle: "root", scopeRootId: "/", expiresAt: Date.now() + 60_000 }, KEY_A);
    const oldScopedHandle = await createResourceHandle({ version: 2, kind: "folder", fileId: "old-child-id", rootId: "/", name: "旧范围目录", parentHandle: "root", scopeRootId: "display-root-id", expiresAt: Date.now() + 60_000 }, KEY_A);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("qryRoutePolicy")) {
        return new Response(JSON.stringify({ success: true, data: { routePolicyList: [{ modName: "personal", httpsUrl: "https://personal.example" }] } }));
      }
      if (url.includes("/file/list")) {
        const body = JSON.parse(String(init?.body || "{}")) as { parentFileId?: string };
        const items = body.parentFileId === "display-root-id"
          ? [{ fileId: "public-file-id", name: "公开文件.pdf", type: "file", size: 128 }]
          : body.parentFileId === "second-root-id"
            ? [{ fileId: "second-file-id", name: "第二个文件.txt", type: "file", size: 64 }]
            : [{ fileId: "original-root-file-id", name: "云盘根文件.txt", type: "file", size: 32 }];
        return new Response(JSON.stringify({ success: true, data: { items, nextPageCursor: "" } }));
      }
      throw new Error(`unexpected provider request: ${url}`);
    });

    try {
      const setRoot = await patchAdminResources(context(new Request("https://example.test/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify({ resourceHandle: displayRootHandle, displayRoot: true }),
        headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
      }), env));
      expect(setRoot.status).toBe(200);
      expect(await readDisplayRoot(env)).toMatchObject({ root: { fileId: "display-root-id", name: "公开目录" }, version: 1 });
      expect(values.has(ADMIN_DISPLAY_ROOT_KEY)).toBe(true);
      expect(values.get(ADMIN_DISPLAY_ROOT_KEY)).not.toContain("display-root-id");

      const publicRoot = await getPublicDirectory({ request: new Request("https://example.test/api/resources?dir=root"), env });
      expect(publicRoot.status).toBe(200);
      expect(await publicRoot.json()).toEqual(expect.objectContaining({
        current: expect.objectContaining({ name: "公开目录", handle: "root" }),
        items: [expect.objectContaining({ name: "公开文件.pdf", kind: "file" })],
      }));

      const hiddenRoot = await updateResourceRule(env, "second-root-id", true);
      expect(hiddenRoot).toBe(1);
      const hiddenRootResponse = await patchAdminResources(context(new Request("https://example.test/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify({ resourceHandle: secondRootHandle, displayRoot: true }),
        headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
      }), env));
      expect(hiddenRootResponse.status).toBe(409);

      const switchRoot = await patchAdminResources(context(new Request("https://example.test/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify({ resourceHandle: secondRootHandle, displayRoot: true }),
        headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
      }), env));
      expect(switchRoot.status).toBe(409);
      await updateResourceRule(env, "second-root-id", false);
      const switchedRoot = await patchAdminResources(context(new Request("https://example.test/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify({ resourceHandle: secondRootHandle, displayRoot: true }),
        headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
      }), env));
      expect(switchedRoot.status).toBe(200);
      expect(await readDisplayRoot(env)).toMatchObject({ root: { fileId: "second-root-id" }, version: 2 });
      expect(values.get(DISPLAY_ROOT_VERSION_KEY)).toBe("2");

      const oldDirectory = await getPublicDirectory({ request: new Request(`https://example.test/api/resources?dir=${encodeURIComponent(oldScopedHandle)}`), env });
      expect(oldDirectory.status).toBe(404);

      const switchedPublicRoot = await getPublicDirectory({ request: new Request("https://example.test/api/resources?dir=root"), env });
      expect(switchedPublicRoot.status).toBe(200);
      expect(await switchedPublicRoot.json()).toEqual(expect.objectContaining({
        current: expect.objectContaining({ name: "第二个目录" }),
        items: [expect.objectContaining({ name: "第二个文件.txt" })],
      }));

      const hideCurrentRoot = await patchAdminResources(context(new Request("https://example.test/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify({ resourceHandle: secondRootHandle, hidden: true }),
        headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
      }), env));
      expect(hideCurrentRoot.status).toBe(409);

      const restoreRoot = await patchAdminResources(context(new Request("https://example.test/api/admin/resources", {
        method: "PATCH",
        body: JSON.stringify({ displayRoot: false }),
        headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
      }), env));
      expect(restoreRoot.status).toBe(200);
      expect(await readDisplayRoot(env)).toMatchObject({ root: null, version: 3 });
      const oldAfterRestore = await getPublicDirectory({ request: new Request(`https://example.test/api/resources?dir=${encodeURIComponent(oldScopedHandle)}`), env });
      expect(oldAfterRestore.status).toBe(404);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("site personalization APIs", () => {
  it("returns defaults publicly and protects the admin settings endpoint", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);

    const publicResponse = await getSiteSettings(context(new Request("https://example.test/api/site-settings"), env));
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({
      siteName: "资源分发站",
      headerTitle: "找到你需要的资源",
      headerSubtitle: "按目录浏览公开资源，文件下载由云端直连。",
      markdown: "",
      customHead: "",
      customContent: "",
      version: 0,
    });

    const privateResponse = await getAdminSiteSettings(context(new Request("https://example.test/api/admin/site-settings"), env));
    expect(privateResponse.status).toBe(401);
  });

  it("requires CSRF, encrypts saved content, and publishes the settings", async () => {
    const { kv, values } = makeKv();
    const env = envWith(kv);
    const login = await postSession(context(new Request("https://example.test/api/admin/session", {
      method: "POST",
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
      headers: { "Content-Type": "application/json" },
    }), env));
    const cookie = cookieFrom(login);
    const loginBody = await login.json() as { csrfToken: string };
    const settings = {
      siteName: "移动云盘资源中心",
      headerTitle: "精选资源下载",
      headerSubtitle: "欢迎浏览最新公开内容。",
      markdown: "## 公告\n\n请先阅读 [使用说明](https://example.test/guide)。\n\n<script>alert('xss')</script>",
      customHead: '<script async src="//example.test/counter.js"></script>',
      customContent: '<div id="customize" style="display:none"><span id="counter"></span></div>',
    };

    const csrfMissing = await patchAdminSiteSettings(context(new Request("https://example.test/api/admin/site-settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
      headers: { Cookie: cookie, "Content-Type": "application/json" },
    }), env));
    expect(csrfMissing.status).toBe(403);

    const saved = await patchAdminSiteSettings(context(new Request("https://example.test/api/admin/site-settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
      headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
    }), env));
    expect(saved.status).toBe(200);
    const stored = values.get(ADMIN_SITE_SETTINGS_KEY) || "";
    expect(stored).not.toContain(settings.siteName);
    expect(stored).not.toContain(settings.markdown);
    expect(stored).not.toContain(settings.customHead);
    expect(stored).not.toContain(settings.customContent);

    const adminBody = await saved.json() as typeof settings & { version: number };
    expect(adminBody).toMatchObject({ ...settings, version: 1 });
    const publicBody = await (await getSiteSettings(context(new Request("https://example.test/api/site-settings"), env))).json();
    expect(publicBody).toMatchObject({ ...settings, version: 1 });
  });

  it("rejects overlong personalization fields", async () => {
    const { kv } = makeKv();
    const env = envWith(kv);
    const login = await postSession(context(new Request("https://example.test/api/admin/session", {
      method: "POST",
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
      headers: { "Content-Type": "application/json" },
    }), env));
    const cookie = cookieFrom(login);
    const loginBody = await login.json() as { csrfToken: string };
    const response = await patchAdminSiteSettings(context(new Request("https://example.test/api/admin/site-settings", {
      method: "PATCH",
      body: JSON.stringify({ siteName: "x".repeat(257) }),
      headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
    }), env));
    expect(response.status).toBe(400);

    const markupResponse = await patchAdminSiteSettings(context(new Request("https://example.test/api/admin/site-settings", {
      method: "PATCH",
      body: JSON.stringify({ customHead: "x".repeat(200001) }),
      headers: { Cookie: cookie, "X-CSRF-Token": loginBody.csrfToken, "Content-Type": "application/json" },
    }), env));
    expect(markupResponse.status).toBe(400);
  });
});
