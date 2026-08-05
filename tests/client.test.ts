import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../lib/env";
import { Yun139Client } from "../lib/139/client";

const authorization = btoa(`pc:13800138000:token|x|y|${Math.floor((Date.now() + 90 * 24 * 60 * 60 * 1000) / 1000)}`);
const env = { YUN139_TYPE: "personal_new" } as Env;

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe("139 client requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses route-specific and personal-cloud headers", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("qryRoutePolicy")) {
        return new Response(JSON.stringify({
          success: true,
          data: { routePolicyList: [{ modName: "personal", httpsUrl: "https://personal.example" }] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: { items: [{ fileId: "folder-1", name: "Folder", type: "folder" }], nextPageCursor: "" },
      }), { status: 200 });
    });

    const items = await new Yun139Client(env, authorization).listFiles("/");
    expect(items[0]?.id).toBe("folder-1");
    expect(requests).toHaveLength(2);
    expect(header(requests[0].init, "Mcloud-Route")).toBeNull();
    expect(header(requests[0].init, "Origin")).toBe("https://yun.139.com");
    expect(header(requests[0].init, "Inner-Hcy-Router-Https")).toBe("1");
    expect(header(requests[1].init, "Mcloud-Route")).toBe("001");
    expect(header(requests[1].init, "X-Yun-Client-Info")).toContain("dW5kZWZpbmVk");
  });

  it("rejects non-http download URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("qryRoutePolicy")) {
        return new Response(JSON.stringify({
          success: true,
          data: { routePolicyList: [{ modName: "personal", httpsUrl: "https://personal.example" }] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: { url: "javascript:alert(1)" } }), { status: 200 });
    });

    await expect(new Yun139Client(env, authorization).getDownloadUrl("file-1"))
      .rejects.toMatchObject({ code: "download_url_invalid" });
  });
});
