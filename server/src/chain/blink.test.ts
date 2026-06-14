import { describe, it, expect } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  signBlinkPayload,
  validateSignerRequest,
  USDC_MAINNET,
  FUNDING_CHAIN_ID,
  type SignerRequest,
} from "./blink";

// Fresh P-256 keypair so the test is self-contained (mirrors the real merchant key).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function req(over: Partial<SignerRequest> = {}): SignerRequest {
  return {
    amount: 25,
    chainId: FUNDING_CHAIN_ID,
    address: "0x1111111111111111111111111111111111111111",
    token: USDC_MAINNET,
    callbackScheme: null,
    url: "https://pay.blink.cash",
    version: "v1",
    ...over,
  };
}

describe("signBlinkPayload", () => {
  it("signs the base64url payload string so it verifies against the public key", () => {
    const out = signBlinkPayload(req(), "merchant-123", privatePem);

    expect(out.merchantId).toBe("merchant-123");
    expect(out.payload).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding

    const verifier = createVerify("SHA256");
    verifier.update(out.payload); // the encoded STRING, not the JSON
    verifier.end();
    expect(verifier.verify(publicPem, Buffer.from(out.signature, "base64url"))).toBe(true);
  });

  it("embeds the canonical fields and echoes them in preview", () => {
    const out = signBlinkPayload(req({ amount: 40 }), "m", privatePem);
    const decoded = JSON.parse(Buffer.from(out.payload, "base64url").toString("utf8"));

    expect(decoded.amount).toBe(40);
    expect(decoded.chainId).toBe(FUNDING_CHAIN_ID);
    expect(decoded.token).toBe(USDC_MAINNET);
    expect(decoded.callbackScheme).toBeNull();
    expect(decoded.version).toBe("v1");
    expect(decoded.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof decoded.signatureTimestamp).toBe("string");
    expect(new Date(decoded.signatureTimestamp).toISOString()).toBe(decoded.signatureTimestamp);

    expect(out.preview.idempotencyKey).toBe(decoded.idempotencyKey);
    expect(out.preview.amount).toBe(40);
  });

  it("gives each request a fresh idempotency key", () => {
    const a = signBlinkPayload(req(), "m", privatePem);
    const b = signBlinkPayload(req(), "m", privatePem);
    expect(a.preview.idempotencyKey).not.toBe(b.preview.idempotencyKey);
  });
});

describe("validateSignerRequest", () => {
  it("accepts a valid mainnet-USDC request", () => {
    expect(validateSignerRequest(req())).toBeNull();
  });

  it("accepts a null amount (user enters it in the hosted flow)", () => {
    expect(validateSignerRequest(req({ amount: null }))).toBeNull();
  });

  it("rejects non-positive amounts", () => {
    expect(validateSignerRequest(req({ amount: 0 }))).toMatch(/amount/);
    expect(validateSignerRequest(req({ amount: -5 }))).toMatch(/amount/);
  });

  it("rejects non-mainnet chains", () => {
    expect(validateSignerRequest(req({ chainId: 8453 }))).toMatch(/chainId/);
  });

  it("rejects tokens other than mainnet USDC", () => {
    expect(validateSignerRequest(req({ token: "0xdeadbeef" }))).toMatch(/token/);
  });

  it("rejects malformed addresses", () => {
    expect(validateSignerRequest(req({ address: "not-an-address" }))).toMatch(/address/);
  });
});
