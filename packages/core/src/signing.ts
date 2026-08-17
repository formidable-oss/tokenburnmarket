// Ed25519 signing over canonical JSON (ADR 0003).
//
// A Device generates a keypair on first connect, the public key is bound to the
// Builder in the browser, and every Sync is signed with the private key. Uses
// WebCrypto only, so the same code runs in Node and in the browser.
//
// Key encoding on the wire: base64. Public keys are raw 32-byte Ed25519 keys,
// private keys are PKCS#8. Signatures are raw 64 bytes.

import { canonicalBytes } from "./canonical-json.js";

const ALGORITHM = "Ed25519";

export class SigningUnavailableError extends Error {
  constructor() {
    super("Ed25519 WebCrypto is unavailable in this runtime");
    this.name = "SigningUnavailableError";
  }
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new SigningUnavailableError();
  return api;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface DeviceKeyPair {
  /** Raw 32-byte Ed25519 public key, base64. Stored on `devices.public_key`. */
  publicKey: string;
  /** PKCS#8 private key, base64. Never leaves the Device. */
  privateKey: string;
}

/** Generate the keypair a Device presents at connect time. */
export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const api = subtle();
  const pair = (await api.generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  const [publicKey, privateKey] = await Promise.all([
    api.exportKey("raw", pair.publicKey),
    api.exportKey("pkcs8", pair.privateKey),
  ]);
  return {
    publicKey: toBase64(new Uint8Array(publicKey)),
    privateKey: toBase64(new Uint8Array(privateKey)),
  };
}

/** Sign any JSON-representable payload. Returns a base64 raw Ed25519 signature. */
export async function signPayload(privateKeyBase64: string, payload: unknown): Promise<string> {
  const api = subtle();
  const key = await api.importKey(
    "pkcs8",
    toArrayBuffer(fromBase64(privateKeyBase64)),
    ALGORITHM,
    false,
    ["sign"],
  );
  const signature = await api.sign(ALGORITHM, key, toArrayBuffer(canonicalBytes(payload)));
  return toBase64(new Uint8Array(signature));
}

/**
 * Verify a signature over a payload. Returns false for a bad signature, a key
 * that will not import, or a payload that cannot be canonicalised, so callers
 * treat every failure the same way and never leak the reason.
 */
export async function verifyPayload(
  publicKeyBase64: string,
  payload: unknown,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const api = subtle();
    const key = await api.importKey(
      "raw",
      toArrayBuffer(fromBase64(publicKeyBase64)),
      ALGORITHM,
      false,
      ["verify"],
    );
    return await api.verify(
      ALGORITHM,
      key,
      toArrayBuffer(fromBase64(signatureBase64)),
      toArrayBuffer(canonicalBytes(payload)),
    );
  } catch {
    return false;
  }
}

// WebCrypto wants an ArrayBuffer, and a Uint8Array view may be a slice of a larger one.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
