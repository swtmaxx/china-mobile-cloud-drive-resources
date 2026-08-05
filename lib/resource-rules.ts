import type { Env } from "./env";
import { AdminError } from "./admin/errors";
import {
  ADMIN_RESOURCE_RULES_KEY,
  incrementNumericValue,
  readAdminJson,
  readNumericValue,
  RESOURCE_RULES_VERSION_KEY,
  writeAdminJson,
} from "./admin/storage";

interface ResourceRulesRecord {
  version: 1;
  hiddenIds: string[];
  updatedAt: number;
}

export interface ResourceRules {
  hiddenIds: Set<string>;
  version: number;
}

export async function readResourceRules(env: Env, recoverCorrupt = false): Promise<ResourceRules> {
  let record: ResourceRulesRecord | null;
  try {
    record = await readAdminJson<ResourceRulesRecord>(env, ADMIN_RESOURCE_RULES_KEY);
  } catch (error) {
    if (!recoverCorrupt || !(error instanceof AdminError) || error.code !== "admin_data_invalid") {
      throw error;
    }
    record = null;
  }
  const hiddenIds = new Set((record?.hiddenIds || []).filter((value) => typeof value === "string" && value.length > 0));
  const version = await readNumericValue(env, RESOURCE_RULES_VERSION_KEY, record?.version === 1 ? 1 : 0);
  return { hiddenIds, version };
}

export async function updateResourceRule(env: Env, resourceId: string, hidden: boolean): Promise<number> {
  const current = await readResourceRules(env, true);
  if (hidden) {
    current.hiddenIds.add(resourceId);
  } else {
    current.hiddenIds.delete(resourceId);
  }
  const version = await incrementNumericValue(env, RESOURCE_RULES_VERSION_KEY, current.version);
  await writeAdminJson(env, ADMIN_RESOURCE_RULES_KEY, {
    version: 1,
    hiddenIds: Array.from(current.hiddenIds).sort(),
    updatedAt: Date.now(),
  } satisfies ResourceRulesRecord);
  return version;
}
