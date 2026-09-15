import type { EncryptedBlob } from "./crypto";

const STORAGE_KEY = "lectra-wallet:v3";
const META_KEY = "lectra-wallet:metadata:v1";
const LEGACY_KEYS = ["bitcoin-wallet:v2", "no-kyc-wallet:v1"];

export interface WalletMetadata {
  receiveIndex: number;
  changeIndex: number;
  lastScannedReceiveIndex: number;
  lastScannedChangeIndex: number;
}

const DEFAULT_METADATA: WalletMetadata = {
  receiveIndex: 0,
  changeIndex: 0,
  lastScannedReceiveIndex: 0,
  lastScannedChangeIndex: 0,
};

function clampIndex(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 0x80000000
    ? value
    : 0;
}

export function saveEncryptedWallet(blob: EncryptedBlob): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

export function loadEncryptedWallet(): EncryptedBlob | null {
  const raw =
    localStorage.getItem(STORAGE_KEY) ??
    LEGACY_KEYS.map(key => localStorage.getItem(key)).find(Boolean);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EncryptedBlob;
    if (!parsed.salt || !parsed.iv || !parsed.ciphertext) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadWalletMetadata(): WalletMetadata {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(META_KEY) ?? "{}"
    ) as Partial<WalletMetadata>;
    return {
      receiveIndex: clampIndex(parsed.receiveIndex),
      changeIndex: clampIndex(parsed.changeIndex),
      lastScannedReceiveIndex: clampIndex(parsed.lastScannedReceiveIndex),
      lastScannedChangeIndex: clampIndex(parsed.lastScannedChangeIndex),
    };
  } catch {
    return { ...DEFAULT_METADATA };
  }
}

export function saveWalletMetadata(metadata: WalletMetadata): void {
  localStorage.setItem(
    META_KEY,
    JSON.stringify({
      receiveIndex: clampIndex(metadata.receiveIndex),
      changeIndex: clampIndex(metadata.changeIndex),
      lastScannedReceiveIndex: clampIndex(metadata.lastScannedReceiveIndex),
      lastScannedChangeIndex: clampIndex(metadata.lastScannedChangeIndex),
    })
  );
}

export function clearStoredWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
}

export function hasStoredWallet(): boolean {
  return Boolean(
    localStorage.getItem(STORAGE_KEY) ??
      LEGACY_KEYS.find(key => localStorage.getItem(key))
  );
}
