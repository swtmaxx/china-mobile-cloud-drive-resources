import type { Env } from "../../../lib/env";
import { jsonResponse } from "../../../lib/http";
import { verifyResourceHandle } from "../../../lib/security/handles";
import { providerEnv } from "../../../lib/provider-config";
import { readResourceRules, updateResourceRule } from "../../../lib/resource-rules";
import { readDisplayRoot, updateDisplayRoot } from "../../../lib/display-root";
import { buildDirectoryResponse, handleSecret, isResourceVisible, listDirectoryItems, resolveDirectory, rootId } from "../../../lib/resources";
import { ensureSession } from "../../../lib/session";
import { readNumericValue, PROVIDER_CONFIG_VERSION_KEY } from "../../../lib/admin/storage";
import { requireAdminSession, requireCsrf } from "../../../lib/admin/auth";
import { adminErrorResponse, AdminError } from "../../../lib/admin/errors";
import { readJsonObject, requiredString } from "../../../lib/admin/request";

interface FunctionContext {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    await requireAdminSession(request, env);
    const configuredEnv = await providerEnv(env);
    const secret = handleSecret(configuredEnv);
    const dir = new URL(request.url).searchParams.get("dir") || "root";
    const target = await resolveDirectory(dir, configuredEnv, secret);
    if (!target) {
      throw new AdminError("目录链接已失效，请从资源根目录重新打开。", 404, "resource_invalid");
    }
    const providerVersion = await readNumericValue(env, PROVIDER_CONFIG_VERSION_KEY, 0);
    await ensureSession(configuredEnv);
    const items = await listDirectoryItems(configuredEnv, target, providerVersion);
    const rules = await readResourceRules(env, true);
    const displayRootState = await readDisplayRoot(env, true);
    const payload = await buildDirectoryResponse(configuredEnv, target, items, secret, undefined, target.scopeRootId);
    return jsonResponse({
      ...payload,
      items: payload.items.map((item, index) => ({
        ...item,
        hidden: rules.hiddenIds.has(items[index]?.id || ""),
        displayRoot: displayRootState.root?.fileId === items[index]?.id,
      })),
      displayRoot: {
        configured: Boolean(displayRootState.root),
        name: displayRootState.root?.name || "资源根目录",
      },
      rulesVersion: rules.version,
      displayRootVersion: displayRootState.version,
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
};

export const onRequestPatch = async ({ request, env }: FunctionContext): Promise<Response> => {
  try {
    const session = await requireAdminSession(request, env);
    requireCsrf(request, session);
    const body = await readJsonObject(request);
    const configuredEnv = await providerEnv(env);
    const secret = handleSecret(configuredEnv);

    if (Object.prototype.hasOwnProperty.call(body, "displayRoot")) {
      if (typeof body.displayRoot !== "boolean") {
        throw new AdminError("展示根目录状态格式不正确。", 400, "invalid_input");
      }
      if (!body.displayRoot) {
        const version = await updateDisplayRoot(env, null);
        return jsonResponse({ displayRoot: { configured: false, name: "资源根目录" }, displayRootVersion: version });
      }
      const resourceHandle = requiredString(body.resourceHandle, "资源句柄", 20_000);
      const payload = await verifyResourceHandle(resourceHandle, secret);
      if (!payload || payload.kind !== "folder" || payload.rootId !== rootId(configuredEnv)) {
        throw new AdminError("目录链接已失效，请刷新目录后重试。", 404, "resource_invalid");
      }
      const rules = await readResourceRules(env, true);
      if (!(await isResourceVisible(payload, configuredEnv, secret, rules))) {
        throw new AdminError("隐藏目录不能作为展示根目录，请先恢复显示。", 409, "display_root_hidden");
      }
      const version = await updateDisplayRoot(env, { fileId: payload.fileId, name: payload.name });
      return jsonResponse({ displayRoot: { configured: true, name: payload.name }, displayRootVersion: version });
    }

    const resourceHandle = requiredString(body.resourceHandle, "资源句柄", 20_000);
    if (typeof body.hidden !== "boolean") {
      throw new AdminError("显示状态格式不正确。", 400, "invalid_input");
    }
    const payload = await verifyResourceHandle(resourceHandle, secret);
    if (!payload || payload.rootId !== rootId(configuredEnv)) {
      throw new AdminError("资源链接已失效，请刷新目录后重试。", 404, "resource_invalid");
    }
    const displayRootState = await readDisplayRoot(env, true);
    if (body.hidden && displayRootState.root?.fileId === payload.fileId) {
      throw new AdminError("请先更换展示根目录，再隐藏当前展示根目录。", 409, "display_root_hidden");
    }
    const version = await updateResourceRule(env, payload.fileId, body.hidden);
    return jsonResponse({ resourceId: payload.fileId, hidden: body.hidden, rulesVersion: version });
  } catch (error) {
    return adminErrorResponse(error);
  }
};
