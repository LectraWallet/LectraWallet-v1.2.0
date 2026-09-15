import type { EncryptedBlob } from "./crypto";

const STORAGE_KEY = "bitcoin-wallet:v2";
const LEGACY_KEYS = ["no-kyc-wallet:v1"];

export function saveEncryptedWallet(blob: EncryptedBlob) { localStorage.setItem(STORAGE_KEY, JSON.stringify(blob)); }
export function loadEncryptedWallet(): EncryptedBlob | null {
  const raw = localStorage.getItem(STORAGE_KEY) ?? LEGACY_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  if (!raw) return null;
  try { return JSON.parse(raw) as EncryptedBlob; } catch { return null; }
}
export function clearStoredWallet() { localStorage.removeItem(STORAGE_KEY); LEGACY_KEYS.forEach((key) => localStorage.removeItem(key)); }
export function hasStoredWallet(): boolean { return Boolean(localStorage.getItem(STORAGE_KEY) ?? LEGACY_KEYS.find((key) => localStorage.getItem(key))); }
