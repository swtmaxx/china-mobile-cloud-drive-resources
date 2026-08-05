import { describe, expect, it } from "vitest";
import { createResourceHandle, verifyResourceHandle } from "../lib/security/handles";
import { parseAuthorization } from "../lib/139/client";

const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("resource handles", () => {
  it("creates and verifies a signed file handle", async () => {
    const handle = await createResourceHandle({
      version: 2,
      kind: "file",
      fileId: "file-1",
      rootId: "/",
      name: "manual.pdf",
      parentHandle: "root",
      expiresAt: Date.now() + 60_000,
    }, secret);
    expect(handle.startsWith("v2.")).toBe(true);
    expect(handle).not.toContain("file-1");
    const payload = await verifyResourceHandle(handle, secret);
    expect(payload?.fileId).toBe("file-1");
    expect(payload?.kind).toBe("file");
    expect(await verifyResourceHandle(handle, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")).toBeNull();
  });

  it("rejects tampered and expired handles", async () => {
    const handle = await createResourceHandle({
      version: 2,
      kind: "folder",
      fileId: "folder-1",
      rootId: "/",
      name: "Folder",
      parentHandle: "root",
      expiresAt: Date.now() - 1,
    }, secret);
    expect(await verifyResourceHandle(`${handle}x`, secret)).toBeNull();
    expect(await verifyResourceHandle(handle, secret)).toBeNull();
  });

  it("rejects legacy readable handles", async () => {
    const legacyPayload = btoa(JSON.stringify({
      version: 1,
      kind: "file",
      fileId: "file-1",
      rootId: "/",
      name: "manual.pdf",
      expiresAt: Date.now() + 60_000,
    })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    expect(await verifyResourceHandle(`${legacyPayload}.signature`, secret)).toBeNull();
  });
});

describe("139 authorization", () => {
  it("parses account and millisecond expiry from the authorization envelope", () => {
    const raw = "pc:13800138000:token|x|y|1780000000000";
    const encoded = btoa(raw);
    const parsed = parseAuthorization(encoded);
    expect(parsed.account).toBe("13800138000");
    expect(parsed.expiresAt).toBe(1780000000000);
  });
});
