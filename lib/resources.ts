import type { Env } from "./env";
import { ProviderError, Yun139Client } from "./139/client";
import type { DirectoryResponse, ResourceHandlePayload, ResourceItem } from "./139/types";
import { base64UrlEncode } from "./139/crypto";
import { createResourceHandle, verifyResourceHandle } from "./security/handles";
import { decodeKeyBytes } from "./security/keys";
import type { ResourceRules } from "./resource-rules";
import type { DisplayRoot } from "./display-root";
import { ensureSession } from "./session";

export interface DirectoryTarget {
  id: string;
  name: string;
  handle: string;
  parentHandle?: string;
  parentName?: string;
  payload?: ResourceHandlePayload;
  scopeRootId?: string;
}

export function rootId(env: Env): string {
  return env.YUN139_ROOT_ID?.trim() || "/";
}

export function displayScopeId(env: Env, displayRoot?: DisplayRoot | null): string {
  return displayRoot?.fileId || rootId(env);
}

export function isInDisplayScope(payload: ResourceHandlePayload, env: Env, displayRoot?: DisplayRoot | null): boolean {
  const configured = Boolean(displayRoot);
  const scope = displayScopeId(env, displayRoot);
  return payload.scopeRootId ? payload.scopeRootId === scope : !configured;
}

export function handleSecret(env: Env): string {
  if (!env.RESOURCE_HANDLE_KEY) {
    throw new ProviderError("RESOURCE_HANDLE_KEY is not configured", 503, "server_misconfigured");
  }
  try {
    decodeKeyBytes(env.RESOURCE_HANDLE_KEY, "RESOURCE_HANDLE_KEY");
  } catch {
    throw new ProviderError("RESOURCE_HANDLE_KEY is invalid", 503, "server_misconfigured");
  }
  return env.RESOURCE_HANDLE_KEY;
}

export function handleTtl(env: Env): number {
  const value = Number.parseInt(env.RESOURCE_HANDLE_TTL || "86400", 10);
  return Number.isFinite(value) && value >= 60 ? value : 86400;
}

export function cacheTtl(env: Env): number {
  const value = Number.parseInt(env.RESOURCE_CACHE_TTL || "60", 10);
  return Number.isFinite(value) && value >= 60 ? value : 60;
}

export async function resolveDirectory(dir: string, env: Env, secret: string, displayRoot?: DisplayRoot | null): Promise<DirectoryTarget | null> {
  if (!dir || dir === "root") {
    return {
      id: displayRoot?.fileId || rootId(env),
      name: displayRoot?.name || "资源根目录",
      handle: "root",
      scopeRootId: displayScopeId(env, displayRoot),
    };
  }
  const payload = await verifyResourceHandle(dir, secret);
  if (!payload || payload.kind !== "folder" || payload.rootId !== rootId(env) || !isInDisplayScope(payload, env, displayRoot)) {
    return null;
  }
  return {
    id: payload.fileId,
    name: payload.name,
    handle: dir,
    parentHandle: payload.parentHandle,
    parentName: payload.parentName,
    payload,
    scopeRootId: payload.scopeRootId || rootId(env),
  };
}

export async function resolvePathDirectory(
  path: string,
  env: Env,
  secret: string,
  rules: ResourceRules,
  displayRoot: DisplayRoot | null,
  providerVersion: number,
): Promise<DirectoryTarget | null> {
  const scopeRoot = displayScopeId(env, displayRoot);
  const rootTarget: DirectoryTarget = {
    id: displayRoot?.fileId || rootId(env),
    name: displayRoot?.name || "资源根目录",
    handle: "root",
    scopeRootId: scopeRoot,
  };
  const segments = path
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return rootTarget;
  }

  let target = rootTarget;
  let parentHandle: string | undefined;
  for (const name of segments) {
    const items = await listDirectoryItems(env, target, providerVersion);
    const folder = items.find((item) => item.kind === "folder" && item.name === name);
    if (!folder || rules.hiddenIds.has(folder.id)) {
      return null;
    }
    const expiresAt = Date.now() + handleTtl(env) * 1000;
    const payload: ResourceHandlePayload = {
      version: 2,
      kind: "folder",
      fileId: folder.id,
      rootId: rootId(env),
      name: folder.name,
      parentHandle,
      parentName: target.name,
      scopeRootId: scopeRoot,
      expiresAt,
    };
    const handle = await createResourceHandle(payload, secret);
    target = {
      id: folder.id,
      name: folder.name,
      handle,
      parentHandle,
      parentName: target.name,
      scopeRootId: scopeRoot,
      payload,
    };
    parentHandle = handle;
  }
  return target;
}

export async function isResourceVisible(
  payload: ResourceHandlePayload,
  env: Env,
  secret: string,
  rules: ResourceRules,
  displayRoot?: DisplayRoot | null,
): Promise<boolean> {
  if (!isInDisplayScope(payload, env, displayRoot) || rules.hiddenIds.has(payload.fileId)) {
    return false;
  }
  let parentHandle = payload.parentHandle;
  const visited = new Set<string>();
  for (let depth = 0; parentHandle && parentHandle !== "root" && depth < 32; depth += 1) {
    if (visited.has(parentHandle)) {
      return false;
    }
    visited.add(parentHandle);
    const parent = await verifyResourceHandle(parentHandle, secret);
    if (!parent || parent.kind !== "folder" || parent.rootId !== rootId(env) || !isInDisplayScope(parent, env, displayRoot) || rules.hiddenIds.has(parent.fileId)) {
      return false;
    }
    parentHandle = parent.parentHandle;
  }
  return !parentHandle || parentHandle === "root";
}

export function rawCacheKey(target: DirectoryTarget, providerVersion: number): string {
  return `admin-resource-list:v1:${providerVersion}:${base64UrlEncode(target.id)}`;
}

export function publicCacheKey(target: DirectoryTarget, providerVersion: number, rulesVersion: number, displayRootVersion = 0): string {
  return `resource-list:v4:${providerVersion}:${rulesVersion}:${displayRootVersion}:${base64UrlEncode(target.id)}`;
}

async function listRawItems(env: Env, target: DirectoryTarget, providerVersion: number): Promise<ResourceItem[]> {
  const key = rawCacheKey(target, providerVersion);
  const cached = await env.RESOURCE_KV.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as ResourceItem[];
      }
    } catch {
      await env.RESOURCE_KV.delete(key);
    }
  }
  const session = await ensureSession(env);
  const client = new Yun139Client(env, session.authorization);
  const items = await client.listFiles(target.id);
  await env.RESOURCE_KV.put(key, JSON.stringify(items), { expirationTtl: cacheTtl(env) });
  return items;
}

export async function buildDirectoryResponse(
  env: Env,
  target: DirectoryTarget,
  items: ResourceItem[],
  secret: string,
  hiddenIds?: Set<string>,
  scopeRootId = target.scopeRootId || rootId(env),
  rootName = "资源根目录",
): Promise<DirectoryResponse> {
  const expiresAt = Date.now() + handleTtl(env) * 1000;
  const responseItems = await Promise.all(items
    .filter((item) => !hiddenIds?.has(item.id))
    .map(async (item) => {
      const payload: ResourceHandlePayload = {
        version: 2,
        kind: item.kind,
        fileId: item.id,
        rootId: rootId(env),
        name: item.name,
        parentHandle: target.handle,
        parentName: target.name,
        scopeRootId,
        expiresAt,
      };
      return {
        handle: await createResourceHandle(payload, secret),
        kind: item.kind,
        name: item.name,
        size: item.size,
        updatedAt: item.updatedAt,
        extension: item.extension,
      };
    }));
  return {
    current: {
      name: target.name,
      handle: target.handle,
      parentHandle: target.parentHandle,
      parentName: target.parentName,
    },
    rootName,
    items: responseItems,
    cachedAt: new Date().toISOString(),
  };
}

export async function listDirectoryItems(env: Env, target: DirectoryTarget, providerVersion: number): Promise<ResourceItem[]> {
  return listRawItems(env, target, providerVersion);
}
