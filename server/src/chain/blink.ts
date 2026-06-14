import { createSign, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { config } from "../config";
import { verifyPrivyToken, getUserAddress } from "./privy";

// Blink deposit signer (Phase 4 of the integration guide).
//
// The client SDK POSTs a SignerRequest here; we build the canonical payload,
// base64url-encode it, sign that STRING (not the raw JSON) with the merchant's
// ECDSA P-256 key, and return the signed bundle. The merchant private key never
// leaves the server. See docs.blink.cash/integration/signer-endpoint.

// This app only funds Ethereum-mainnet USDC, so the signer refuses anything
// else — the merchant key authorizes deposits, and we don't want it signing
// arbitrary chains/tokens even if a caller asks.
export const FUNDING_CHAIN_ID = 1;
export const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// What the SDK sends us.
export interface SignerRequest {
  amount: number | null;
  chainId: number;
  address: string;
  token: string;
  callbackScheme: string | null;
  url: string;
  version: "v1";
  reference?: string;
  metadata?: Record<string, string>;
}

// What we must return for the hosted flow to load.
export interface SignerResponse {
  merchantId: string;
  payload: string;
  signature: string;
  preview: {
    amount: number | null;
    chainId: number;
    address: string;
    token: string;
    idempotencyKey: string;
  };
}

const CALLBACK_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*$/;

// Validate a request, returning an error string or null. Kept pure for testing.
export function validateSignerRequest(req: SignerRequest): string | null {
  if (req.amount !== null && !(Number.isFinite(req.amount) && req.amount > 0)) {
    return "amount must be a positive number or null";
  }
  if (!Number.isInteger(req.chainId) || req.chainId !== FUNDING_CHAIN_ID) {
    return `chainId must be ${FUNDING_CHAIN_ID} (Ethereum mainnet)`;
  }
  if (typeof req.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(req.address)) {
    return "address must be a 0x EVM address";
  }
  if (typeof req.token !== "string" || req.token.toLowerCase() !== USDC_MAINNET.toLowerCase()) {
    return "token must be mainnet USDC";
  }
  if (req.callbackScheme !== null && !CALLBACK_SCHEME_RE.test(req.callbackScheme)) {
    return "invalid callbackScheme";
  }
  return null;
}

// Build the canonical payload, base64url it, and sign the encoded STRING with
// ECDSA P-256 + SHA-256. Pure given (request, merchantId, key) so it can be
// unit-tested and the signature verified against the public key.
export function signBlinkPayload(
  req: SignerRequest,
  merchantId: string,
  signerKeyPem: string
): SignerResponse {
  const idempotencyKey = randomUUID();
  const payloadObject = {
    amount: req.amount,
    chainId: req.chainId,
    address: req.address,
    token: req.token,
    idempotencyKey,
    // Web SDK sends null; mobile sends a URL scheme. Echo whatever arrived.
    callbackScheme: req.callbackScheme ?? null,
    signatureTimestamp: new Date().toISOString(),
    version: req.version ?? "v1",
  };

  const payload = Buffer.from(JSON.stringify(payloadObject), "utf8").toString("base64url");

  const signer = createSign("SHA256");
  signer.update(payload); // sign the base64url string, NOT the raw JSON
  signer.end();
  const signature = signer.sign(signerKeyPem).toString("base64url");

  return {
    merchantId,
    payload,
    signature,
    preview: {
      amount: req.amount,
      chainId: req.chainId,
      address: req.address,
      token: req.token,
      idempotencyKey,
    },
  };
}

function bearer(req: Request): string {
  return (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
}

export function registerBlink(app: Express): void {
  app.post("/api/sign-payment", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");

    if (!config.blinkMerchantId || !config.blinkSignerKey) {
      return res
        .status(503)
        .json({ error: "Blink not configured: set BLINK_MERCHANT_ID and BLINK_SIGNER_KEY" });
    }

    // Authenticate the caller and bind the deposit to their own wallet so our
    // merchant key can't be used to sign deposits to arbitrary addresses.
    let callerAddress: string;
    try {
      const { userId } = await verifyPrivyToken(bearer(req));
      callerAddress = await getUserAddress(userId);
    } catch (e: any) {
      return res.status(401).json({ error: `unauthorized: ${e?.message ?? e}` });
    }

    const body = req.body as SignerRequest;
    const invalid = validateSignerRequest(body);
    if (invalid) return res.status(400).json({ error: invalid });

    if (body.address.toLowerCase() !== callerAddress.toLowerCase()) {
      return res.status(403).json({ error: "address does not match the authenticated wallet" });
    }

    try {
      const signed = signBlinkPayload(body, config.blinkMerchantId, config.blinkSignerKey);
      return res.json(signed);
    } catch (e: any) {
      console.error("[sign-payment] signing failed:", e);
      return res.status(500).json({ error: "could not sign payload" });
    }
  });
}
