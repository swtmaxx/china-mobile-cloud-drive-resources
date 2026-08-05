import { XMLParser } from "fast-xml-parser";
import type { Env } from "../env";
import type {
  PersonalDownloadResponse,
  PersonalListResponse,
  ResourceItem,
  RoutePolicyResponse,
  SessionState,
  ThirdLoginResult,
} from "./types";
import {
  base64UrlEncode,
  calculateSign,
  decodeHexUtf8,
  decodeUtf8Base64,
  decryptAesCbcEnvelope,
  decryptAesEcbHex,
  encryptAesCbcEnvelope,
  formatChinaTimestamp,
  randomString,
  sha1Hex,
  utf8Base64,
} from "./crypto";

const KEY_HEX_1 = "73634235495062495331515373756c734e7253306c673d3d";
const KEY_HEX_2 = "7150714477323633586746674c337538";
const ROUTE_URL = "https://user-njs.yun.139.com/user/route/qryRoutePolicy";
const REFRESH_URL = "https://aas.caiyun.feixin.10086.cn:443/tellin/authTokenRefresh.do";
const LOGIN_URL = "https://mail.10086.cn/Login/Login.ashx";
const ARTIFACT_URL = "https://smsrebuild1.mail.10086.cn/setting/s";
const THIRD_LOGIN_URL = "https://user-njs.yun.139.com/user/thirdlogin";
const PROVIDER_TIMEOUT_MS = 20_000;

export class ProviderError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code = "provider_error") {
    super(message);
    this.name = "ProviderError";
  }
}

export interface LoginResult {
  state: SessionState;
  mailCookies?: string;
}

function normalizeAuthorization(value: string): string {
  return value.replace(/^Basic\s+/i, "").trim();
}

export function parseAuthorization(value: string): { account: string; token: string; expiresAt?: number } {
  const normalized = normalizeAuthorization(value);
  const decoded = decodeUtf8Base64(normalized);
  const pieces = decoded.split(":");
  if (pieces.length < 3 || !pieces[1] || !pieces.slice(2).join(":")) {
    throw new Error("139 Authorization format is invalid");
  }
  const token = pieces.slice(2).join(":");
  const expirationText = token.split("|")[3];
  const expirationValue = expirationText ? Number.parseInt(expirationText, 10) : Number.NaN;
  const expiresAt = Number.isFinite(expirationValue)
    ? expirationValue < 1_000_000_000_000
      ? expirationValue * 1000
      : expirationValue
    : undefined;
  return { account: pieces[1], token, expiresAt };
}

export function sessionFromAuthorization(authorization: string, userDomainId?: string): SessionState {
  const parsed = parseAuthorization(authorization);
  return {
    authorization: normalizeAuthorization(authorization),
    account: parsed.account,
    userDomainId,
    expiresAt: parsed.expiresAt,
    updatedAt: Date.now(),
  };
}

function cookiePairs(value: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /(?:^|[,;]\s*)([^=;,\s]+)=([^;,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    result.set(match[1], match[2]);
  }
  return result;
}

function mergeCookies(...values: string[]): string {
  const merged = new Map<string, string>();
  for (const value of values) {
    for (const [name, cookie] of cookiePairs(value)) {
      merged.set(name, cookie);
    }
  }
  return Array.from(merged.entries(), ([name, value]) => `${name}=${value}`).join("; ");
}

function cookieValue(cookies: string, name: string): string | undefined {
  return cookiePairs(cookies).get(name);
}

function queryValue(location: string, name: string): string | undefined {
  try {
    return new URL(location, LOGIN_URL).searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function extensionFor(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return undefined;
  }
  return name.slice(dot + 1).toLowerCase();
}

async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderError("139 request timed out", 504, "provider_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export class Yun139Client {
  private readonly authorization: string;
  private personalCloudHost?: string;

  constructor(private readonly env: Env, authorization: string) {
    this.authorization = normalizeAuthorization(authorization);
  }

  getAuthorization(): string {
    return this.authorization;
  }

  needsRefresh(): boolean {
    const { expiresAt } = parseAuthorization(this.authorization);
    return expiresAt !== undefined && expiresAt - Date.now() <= 15 * 24 * 60 * 60 * 1000;
  }

  isExpired(): boolean {
    const { expiresAt } = parseAuthorization(this.authorization);
    return expiresAt !== undefined && expiresAt <= Date.now();
  }

  private headers(extra: Record<string, string> = {}, includeRoute = true): Record<string, string> {
    const svcType = this.env.YUN139_TYPE === "family" ? "2" : "1";
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Authorization": `Basic ${this.authorization}`,
      "Caller": "web",
      "CMS-DEVICE": "default",
      "Mcloud-Channel": "1000101",
      "Mcloud-Client": "10701",
      "Mcloud-Version": "7.14.0",
      Origin: "https://yun.139.com",
      Referer: "https://yun.139.com/w/",
      "x-DeviceInfo": "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||",
      "x-huawei-channelSrc": "10000034",
      "x-inner-ntwk": "2",
      "x-m4c-caller": "PC",
      "x-m4c-src": "10002",
      "x-SvcType": svcType,
      "Inner-Hcy-Router-Https": "1",
      "X-Yun-Api-Version": "v1",
      "X-Yun-App-Channel": "10000034",
      "X-Yun-Channel-Source": "10000034",
      "X-Yun-Client-Info": "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||dW5kZWZpbmVk||",
      "X-Yun-Module-Type": "100",
      "X-Yun-Svc-Type": "1",
    };
    if (includeRoute) {
      headers["Mcloud-Route"] = "001";
    }
    return { "Content-Type": "application/json;charset=UTF-8", ...headers, ...extra };
  }

  private async postJson<T>(url: string, body: Record<string, unknown>, includeRoute = true): Promise<T> {
    const serialized = JSON.stringify(body);
    const timestamp = formatChinaTimestamp();
    const random = randomString(16);
    const response = await providerFetch(url, {
      method: "POST",
      headers: this.headers({ "Mcloud-Sign": `${timestamp},${random},${calculateSign(serialized, timestamp, random)}` }, includeRoute),
      body: serialized,
    });
    const text = await response.text();
    let payload: T & { success?: boolean; message?: string; code?: string };
    try {
      payload = (text ? JSON.parse(text) : {}) as T & { success?: boolean; message?: string; code?: string };
    } catch {
      throw new ProviderError(`139 returned invalid JSON (${response.status})`);
    }
    if (!response.ok || payload.success === false) {
      throw new ProviderError(payload.message || `139 request failed (${response.status})`, response.status);
    }
    return payload;
  }

  private async getPersonalHost(): Promise<string> {
    if (this.personalCloudHost) {
      return this.personalCloudHost;
    }
    const response = await this.postJson<RoutePolicyResponse>(ROUTE_URL, {
      userInfo: {
        userType: 1,
        accountType: 1,
        accountName: parseAuthorization(this.authorization).account,
      },
      modAddrType: 1,
    }, false);
    const item = response.data?.routePolicyList?.find((policy) => policy.modName?.toLowerCase() === "personal");
    if (!item?.httpsUrl) {
      throw new ProviderError("139 personal cloud route is unavailable");
    }
    this.personalCloudHost = item.httpsUrl.replace(/\/+$/, "");
    return this.personalCloudHost;
  }

  async listFiles(parentFileId: string): Promise<ResourceItem[]> {
    const host = await this.getPersonalHost();
    const items: ResourceItem[] = [];
    let cursor = "";
    let previousCursor = "";

    for (let page = 0; page < 100; page += 1) {
      const response = await this.postJson<PersonalListResponse>(`${host}/file/list`, {
        imageThumbnailStyleList: ["Small", "Large"],
        orderBy: "updated_at",
        orderDirection: "DESC",
        pageInfo: {
          pageCursor: cursor,
          pageSize: 100,
        },
        parentFileId,
      });
      const pageItems = response.data?.items ?? [];
      for (const item of pageItems) {
        if (!item.fileId || !item.name) {
          continue;
        }
        const kind = item.type === "folder" ? "folder" : "file";
        items.push({
          id: item.fileId,
          name: item.name,
          kind,
          size: kind === "file" ? Number(item.size ?? 0) : 0,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          extension: kind === "file" ? extensionFor(item.name) : undefined,
        });
      }
      const nextCursor = response.data?.nextPageCursor ?? "";
      if (!nextCursor || nextCursor === cursor || nextCursor === previousCursor || pageItems.length === 0) {
        break;
      }
      previousCursor = cursor;
      cursor = nextCursor;
    }
    return items;
  }

  async getDownloadUrl(fileId: string): Promise<string> {
    const host = await this.getPersonalHost();
    const response = await this.postJson<PersonalDownloadResponse>(`${host}/file/getDownloadUrl`, { fileId });
    const data = response.data;
    const url = data?.cdnSwitch && data.cdnUrl ? data.cdnUrl : data?.url || data?.cdnUrl;
    if (!url) {
      throw new ProviderError("139 did not return a download URL");
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new ProviderError("139 returned an invalid download URL", 502, "download_url_invalid");
    }
    return url;
  }

  async refreshToken(): Promise<SessionState> {
    const parsed = parseAuthorization(this.authorization);
    if (!parsed.token) {
      throw new ProviderError("139 Authorization does not contain a token", 401, "invalid_authorization");
    }
    const body = `<root><token>${parsed.token}</token><account>${parsed.account}</account><clienttype>656</clienttype></root>`;
    const response = await providerFetch(REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/xml", Accept: "application/xml, text/xml, */*" },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ProviderError(`139 token refresh failed (${response.status})`, response.status, "refresh_failed");
    }
    const parsedXml = new XMLParser({ ignoreAttributes: false }).parse(text) as {
      root?: { return?: string; token?: string; desc?: string };
    };
    const result = parsedXml.root ?? {};
    if (String(result.return ?? "") !== "0" || !result.token) {
      throw new ProviderError(asText(result.desc) || "139 token refresh was rejected", 401, "refresh_rejected");
    }
    const authorization = utf8Base64(`pc:${parsed.account}:${result.token}`);
    return sessionFromAuthorization(authorization);
  }

  async loginWithPassword(mailCookiesOverride?: string): Promise<LoginResult> {
    const username = this.env.YUN139_USERNAME?.trim();
    const password = this.env.YUN139_PASSWORD;
    let mailCookies = mailCookiesOverride?.trim() || this.env.YUN139_MAIL_COOKIES?.trim() || "";
    if (!username || !password || !mailCookies) {
      throw new ProviderError("139 password login requires username, password and MailCookies", 503, "credentials_missing");
    }

    const cguid = String(Date.now());
    const loginData = new URLSearchParams({
      UserName: username,
      passOld: "",
      auto: "on",
      Password: sha1Hex(`fetion.com.cn:${password}`),
      webIndexPagePwdLogin: "1",
      pwdType: "1",
      clientId: "1003",
      authType: "2",
    });
    const referer = `https://mail.10086.cn/default.html?&s=1&v=0&u=${utf8Base64(username)}&m=1&ec=S001&resource=indexLogin&clientid=1003&auto=on&cguid=${cguid}&mtime=45`;
    const loginResponse = await providerFetch(LOGIN_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://mail.10086.cn",
        Referer: referer,
        Cookie: mailCookies,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
      },
      body: loginData.toString(),
    });
    const location = loginResponse.headers.get("location") ?? "";
    const responseCookies = loginResponse.headers.get("set-cookie") ?? "";
    mailCookies = mergeCookies(mailCookies, responseCookies);
    const sid = queryValue(location, "sid") || cookieValue(mailCookies, "Os_SSo_Sid");
    const artifactCguid = queryValue(location, "cguid") || cookieValue(mailCookies, "cguid") || cguid;
    if (!sid || !artifactCguid) {
      throw new ProviderError("139 mail login did not return a session", 401, "mail_login_failed");
    }

    const rmkey = cookieValue(mailCookies, "RMKEY");
    if (!rmkey) {
      throw new ProviderError("139 MailCookies does not contain RMKEY", 401, "mail_cookie_invalid");
    }
    const artifactResponse = await providerFetch(`${ARTIFACT_URL}?func=${encodeURIComponent("umc:getArtifact")}&sid=${encodeURIComponent(sid)}&cguid=${encodeURIComponent(artifactCguid)}`, {
      method: "POST",
      headers: {
        Cookie: `RMKEY=${rmkey}`,
        "Content-Type": "text/xml; charset=utf-8",
        "Accept-Encoding": "gzip",
        "User-Agent": "okhttp/4.12.0",
      },
    });
    const artifactText = await artifactResponse.text();
    let artifactJson: { var?: { artifact?: string } };
    try {
      artifactJson = JSON.parse(artifactText) as { var?: { artifact?: string } };
    } catch {
      throw new ProviderError("139 artifact response was invalid", 502, "artifact_invalid");
    }
    const dycpwd = artifactJson.var?.artifact;
    if (!artifactResponse.ok || !dycpwd) {
      throw new ProviderError("139 artifact exchange failed", 401, "artifact_failed");
    }

    const thirdLoginBody = {
      clientkey_decrypt: "l3TryM&Q+X7@dzwk)qP",
      clienttype: "886",
      cpid: "507",
      dycpwd,
      extInfo: { ifOpenAccount: "0" },
      loginMode: "0",
      msisdn: username,
      pintype: "13",
      secinfo: sha1Hex(`fetion.com.cn:${dycpwd}`).toUpperCase(),
      version: "20250901",
    };
    const encryptedResponse = await this.encryptedRequest(THIRD_LOGIN_URL, thirdLoginBody, {
      "hcy-cool-flag": "1",
      "x-huawei-channelSrc": "10246600",
      "x-sdk-channelSrc": "",
      "x-MM-Source": "0",
      "x-UserAgent": "android|23116PN5BC|android15|1.2.6|||1440x3200|10246600",
      "x-DeviceInfo": "4|127.0.0.1|5|1.2.6|Xiaomi|23116PN5BC||02-00-00-00-00-00|android 15|1440x3200|android|||",
      "Content-Type": "text/plain;charset=UTF-8",
      "Accept-Encoding": "gzip",
      "User-Agent": "okhttp/3.12.2",
    }, KEY_HEX_1);
    const firstLayer = JSON.parse(encryptedResponse) as { data?: string };
    if (!firstLayer.data) {
      throw new ProviderError("139 third login response has no encrypted data", 401, "third_login_failed");
    }
    const finalJson = JSON.parse(decryptAesEcbHex(firstLayer.data, KEY_HEX_2)) as ThirdLoginResult;
    if (!finalJson.authToken || !finalJson.account) {
      throw new ProviderError("139 third login did not return an authorization token", 401, "third_login_failed");
    }
    const authorization = utf8Base64(`pc:${finalJson.account}:${finalJson.authToken}`);
    return {
      state: sessionFromAuthorization(authorization, finalJson.userDomainId),
      mailCookies,
    };
  }

  private async encryptedRequest(url: string, body: unknown, headers: Record<string, string>, keyHex: string): Promise<string> {
    const response = await providerFetch(url, {
      method: "POST",
      headers,
      body: encryptAesCbcEnvelope(body, keyHex),
    });
    const text = (await response.text()).trim();
    if (!response.ok) {
      throw new ProviderError(`139 encrypted request failed (${response.status})`, response.status);
    }
    if (text.startsWith("{")) {
      return text;
    }
    try {
      return decryptAesCbcEnvelope(text, keyHex);
    } catch {
      throw new ProviderError("139 encrypted response could not be decrypted", 502, "encrypted_response_invalid");
    }
  }
}
