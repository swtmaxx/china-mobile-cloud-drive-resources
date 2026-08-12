export interface RoutePolicyItem {
  modName?: string;
  httpsUrl?: string;
}

export interface RoutePolicyResponse {
  success?: boolean;
  code?: string;
  message?: string;
  data?: {
    routePolicyList?: RoutePolicyItem[];
  };
}

export interface PersonalFileItem {
  fileId?: string;
  name?: string;
  size?: number;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnailUrls?: Array<{ style?: string; url?: string }>;
}

export interface PersonalListResponse {
  success?: boolean;
  code?: string;
  message?: string;
  data?: {
    items?: PersonalFileItem[];
    nextPageCursor?: string;
  };
}

export interface PersonalDownloadResponse {
  success?: boolean;
  code?: string;
  message?: string;
  data?: {
    url?: string;
    cdnUrl?: string;
    cdnSwitch?: boolean;
  };
}

export interface RefreshTokenResponse {
  root?: {
    return?: string;
    token?: string;
    expiretime?: string;
    accessToken?: string;
    desc?: string;
  };
  return?: string;
  token?: string;
  expiretime?: string;
  accessToken?: string;
  desc?: string;
}

export interface ThirdLoginResult {
  authToken?: string;
  account?: string;
  userDomainId?: string;
}

export interface ResourceItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  size: number;
  createdAt?: string;
  updatedAt?: string;
  extension?: string;
}

export interface ResourceHandlePayload {
  version: 2;
  kind: "folder" | "file";
  fileId: string;
  rootId: string;
  name: string;
  parentHandle?: string;
  parentName?: string;
  scopeRootId?: string;
  expiresAt: number;
}

export interface DirectoryResponse {
  current: {
    name: string;
    handle: string;
    parentHandle?: string;
    parentName?: string;
  };
  rootName: string;
  items: Array<{
    handle: string;
    kind: "folder" | "file";
    name: string;
    size: number;
    updatedAt?: string;
    extension?: string;
  }>;
  cachedAt: string;
}

export interface SessionState {
  authorization: string;
  account: string;
  userDomainId?: string;
  mailCookies?: string;
  expiresAt?: number;
  updatedAt: number;
}
