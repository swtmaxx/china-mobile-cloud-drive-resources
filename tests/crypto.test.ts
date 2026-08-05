import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import {
  calculateSign,
  decryptAesCbcEnvelope,
  decryptAesEcbHex,
  encryptAesCbcEnvelope,
  sortedJsonStringify,
} from "../lib/139/crypto";

describe("139 protocol crypto", () => {
  it("matches the mcloud-sign fixed vector", () => {
    expect(calculateSign(JSON.stringify({ a: 1 }), "2026-08-05 12:34:56", "abc")).toBe("D083AD012DF6B0821C8357730135A307");
  });

  it("sorts encrypted request JSON recursively", () => {
    expect(sortedJsonStringify({ z: 1, a: { y: true, b: "x" }, list: [2, 1] })).toBe('{"a":{"b":"x","y":true},"list":[2,1],"z":1}');
  });

  it("round-trips the 139 AES-CBC envelope", () => {
    const key = "00112233445566778899aabbccddeeff";
    const envelope = encryptAesCbcEnvelope({ z: 1, a: "two" }, key);
    expect(decryptAesCbcEnvelope(envelope, key)).toBe('{"a":"two","z":1}');
  });

  it("decrypts the legacy AES-ECB layer", () => {
    const key = CryptoJS.enc.Hex.parse("00112233445566778899aabbccddeeff");
    const encrypted = CryptoJS.AES.encrypt("{\"authToken\":\"token\"}", key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).ciphertext;
    expect(decryptAesEcbHex(CryptoJS.enc.Hex.stringify(encrypted), "00112233445566778899aabbccddeeff")).toBe('{"authToken":"token"}');
  });
});
