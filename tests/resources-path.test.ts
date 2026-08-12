import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../lib/env";
import type { ResourceRules } from "../lib/resource-rules";
import { resolvePathDirectory } from "../lib/resources";
import { base64UrlEncode } from "../lib/139/crypto";

const secret = "A".repeat(43);
const authorization = btoa(`pc:13800138000:token|x|y|${Date.now() + 90 * 24 * 60 * 60 * 1000}`);

const env = {
  YUN139_TYPE: "personal_new",
  YUN139_ROOT_ID: "/",
  RESOURCE_HANDLE_KEY: secret,
  RESOURCE_HANDLE_TTL: "86400",
  RESOURCE_CACHE_TTL: "60",
  AUTH_ENCRYPTION_KEY: "A".repeat(43),
  YUN139_AUTHORIZATION: authorization,
  RESOURCE_KV: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  },
} as unknown as Env;

const rules: ResourceRules = { hiddenIds: new Set(), version: 0 };

function listResponse(items: Array<{ fileId: string; name: string; type: string; size?: number }>): Response {
  return new Response(JSON.stringify({ success: true, data: { items, nextPageCursor: "" } }), { status: 200 });
}

function mock139(foldersByParent: Record<string, Array<{ fileId: string; name: string; type: string }>>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("qryRoutePolicy")) {
      return new Response(JSON.stringify({
        success: true,
        data: { routePolicyList: [{ modName: "personal", httpsUrl: "https://personal.example" }] },
      }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as { parentFileId?: string };
    return listResponse(foldersByParent[body.parentFileId || "/"] || []);
  });
}

describe("path directory resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a nested folder path into a directory target", async () => {
    mock139({
      "/": [{ fileId: "folder-sub", name: "Sub", type: "folder" }],
      "folder-sub": [
        { fileId: "folder-target", name: "Target", type: "folder" },
        { fileId: "file-1", name: "note.txt", type: "file" },
      ],
    });

    const target = await resolvePathDirectory("/Sub/Target", env, secret, rules, null, 0);
    expect(target?.id).toBe("folder-target");
    expect(target?.name).toBe("Target");
    expect(target?.parentName).toBe("Sub");
    expect(target?.handle.startsWith("v2.")).toBe(true);
    expect(target?.payload?.kind).toBe("folder");
  });

  it("returns null when a path segment does not exist", async () => {
    mock139({
      "/": [{ fileId: "folder-sub", name: "Sub", type: "folder" }],
      "folder-sub": [{ fileId: "folder-other", name: "Other", type: "folder" }],
    });

    expect(await resolvePathDirectory("/Sub/DoesNotExist", env, secret, rules, null, 0)).toBeNull();
  });

  it("returns the root target for an empty path", async () => {
    const target = await resolvePathDirectory("/", env, secret, rules, null, 0);
    expect(target?.id).toBe("/");
    expect(target?.handle).toBe("root");
    expect(target?.name).toBe("资源根目录");
  });

  it("rejects navigation into a hidden folder", async () => {
    mock139({
      "/": [{ fileId: "folder-secret", name: "Secret", type: "folder" }],
    });

    const hiddenRules: ResourceRules = { hiddenIds: new Set(["folder-secret"]), version: 1 };
    expect(await resolvePathDirectory("/Secret", env, secret, hiddenRules, null, 0)).toBeNull();
  });

  it("force refresh bypasses the raw directory cache", async () => {
    const kv = new Map<string, string>();
    kv.set(`admin-resource-list:v1:0:${base64UrlEncode("/")}`, JSON.stringify([
      { id: "folder-old", name: "Old", kind: "folder", size: 0 },
    ]));
    const envWithKv = {
      ...env,
      RESOURCE_KV: {
        get: async (key: string) => kv.get(key) ?? null,
        put: async (key: string, value: string) => { kv.set(key, value); },
        delete: async (key: string) => { kv.delete(key); },
      },
    } as unknown as Env;

    const fetchSpy = mock139({ "/": [{ fileId: "folder-new", name: "New", type: "folder" }] });

    // Cached root listing is used without a network round trip.
    const cachedTarget = await resolvePathDirectory("/Old", envWithKv, secret, rules, null, 0);
    expect(cachedTarget?.id).toBe("folder-old");
    expect(fetchSpy).not.toHaveBeenCalled();

    // forceRefresh re-lists from the provider and finds the new folder.
    const freshTarget = await resolvePathDirectory("/New", envWithKv, secret, rules, null, 0, true);
    expect(freshTarget?.id).toBe("folder-new");
    expect(fetchSpy).toHaveBeenCalled();
  });
});
