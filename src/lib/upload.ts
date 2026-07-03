// Encrypt + upload one document and persist it to the vault store, returning the
// StoredUpload. Mirrors UploadFlow's single-file path so ticket attachments reuse
// the exact same encrypted-upload pipeline (owner-only, master key scheme). Kept
// standalone so the main upload flow is untouched.

import { encryptFile, type DocumentType } from "./crypto";
import { uploadToArweave } from "./irys";
import { StoredUpload, saveUpload, toBase64 } from "./vault";

export async function uploadDocument(
  file: File,
  docType: DocumentType,
  address: string,
  onStatus?: (s: string) => void,
): Promise<StoredUpload> {
  const payload = await encryptFile(file, docType, (step) => onStatus?.(step));
  const result = await uploadToArweave(payload, (status, detail) => onStatus?.(detail || status));

  let rawKeyBase64: string | undefined;
  if (payload.aesKey) {
    try {
      const rawKey = await crypto.subtle.exportKey("raw", payload.aesKey);
      rawKeyBase64 = toBase64(new Uint8Array(rawKey));
      localStorage.setItem(`gtv_aes_${result.txId}`, rawKeyBase64);
    } catch { /* non-critical */ }
  }

  const stored: StoredUpload = {
    txId: result.txId,
    irysGatewayUrl: result.irysGatewayUrl,
    gatewayUrl: result.gatewayUrl,
    originalName: payload.originalName,
    originalType: payload.originalType,
    originalSize: payload.originalSize,
    documentType: payload.documentType,
    uploadedAt: Date.now(),
    ivBase64: toBase64(payload.iv),
    wrappedKeyBase64: toBase64(payload.wrappedKey),
    tags: [],
    rawKeyBase64,
    keyScheme: payload.keyScheme ?? "master",
  };
  saveUpload(address, stored);
  return stored;
}
