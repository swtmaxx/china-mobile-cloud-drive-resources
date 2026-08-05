import type { Env } from "./env";
import { AdminError } from "./admin/errors";
import {
  ADMIN_DISPLAY_ROOT_KEY,
  DISPLAY_ROOT_VERSION_KEY,
  deleteAdminValue,
  incrementNumericValue,
  readAdminJson,
  readNumericValue,
  writeAdminJson,
} from "./admin/storage";

export interface DisplayRoot {
  fileId: string;
  name: string;
}

export interface DisplayRootState {
  root: DisplayRoot | null;
  version: number;
}

export async function readDisplayRoot(env: Env, recoverCorrupt = false): Promise<DisplayRootState> {
  let root: DisplayRoot | null;
  try {
    const record = await readAdminJson<DisplayRoot>(env, ADMIN_DISPLAY_ROOT_KEY);
    root = record && typeof record.fileId === "string" && typeof record.name === "string" && record.fileId && record.name
      ? { fileId: record.fileId, name: record.name }
      : null;
  } catch (error) {
    if (!recoverCorrupt || !(error instanceof AdminError) || error.code !== "admin_data_invalid") {
      throw error;
    }
    root = null;
  }
  return {
    root,
    version: await readNumericValue(env, DISPLAY_ROOT_VERSION_KEY, 0),
  };
}

export async function updateDisplayRoot(env: Env, root: DisplayRoot | null): Promise<number> {
  if (root) {
    await writeAdminJson(env, ADMIN_DISPLAY_ROOT_KEY, root);
  } else {
    await deleteAdminValue(env, ADMIN_DISPLAY_ROOT_KEY);
  }
  return incrementNumericValue(env, DISPLAY_ROOT_VERSION_KEY, 0);
}
