import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as btc from "@scure/btc-signer";
import { getBtcNetwork } from "./btcNetwork";

export type WalletBranch = 0 | 1;

export interface BtcAccount {
  address: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  path: string;
  branch: WalletBranch;
  index: number;
  masterFingerprint: number;
}

export const BIP84_GAP_LIMIT = 20;

export function createNewMnemonic(): string {
  return generateMnemonic(english, 128);
}

export function normalizeMnemonic(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\b(?:word\s*)?\d{1,2}[.)]?\s*/gi, " ")
    .replace(/[,\n\r\t]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isValidMnemonic(value: string): boolean {
  const normalized = normalizeMnemonic(value);
  const words = normalized.split(/\s+/);
  return (
    [12, 15, 18, 21, 24].includes(words.length) &&
    validateMnemonic(normalized, english)
  );
}

function walletNetwork() {
  return getBtcNetwork() === "mainnet" ? btc.NETWORK : btc.TEST_NETWORK;
}

function networkCoinType(): 0 | 1 {
  return getBtcNetwork() === "mainnet" ? 0 : 1;
}

export function accountFromMnemonicBtc(
  mnemonic: string,
  index = 0,
  branch: WalletBranch = 0
): BtcAccount {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error("Invalid BIP84 address index.");
  }
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic));
  try {
    const root = HDKey.fromMasterSeed(seed);
    const path = `m/84'/${networkCoinType()}'/0'/${branch}/${index}`;
    const child = root.derive(path);
    if (!child.privateKey) throw new Error("Failed to derive Bitcoin key.");
    const publicKey = secp256k1.getPublicKey(child.privateKey, true);
    const payment = btc.p2wpkh(publicKey, walletNetwork());
    if (!payment.address) throw new Error("Failed to derive Bitcoin address.");
    return {
      address: payment.address,
      privateKey: child.privateKey,
      publicKey,
      path,
      branch,
      index,
      masterFingerprint: root.fingerprint,
    };
  } finally {
    seed.fill(0);
  }
}

export function deriveReceiveAccounts(
  mnemonic: string,
  lastIndex: number
): BtcAccount[] {
  const safeLastIndex = Math.max(0, lastIndex);
  return Array.from({ length: safeLastIndex + 1 }, (_, index) =>
    accountFromMnemonicBtc(mnemonic, index, 0)
  );
}

export function deriveChangeAccounts(
  mnemonic: string,
  lastIndex: number
): BtcAccount[] {
  const safeLastIndex = Math.max(0, lastIndex);
  return Array.from({ length: safeLastIndex + 1 }, (_, index) =>
    accountFromMnemonicBtc(mnemonic, index, 1)
  );
}

export function wipeAccount(account: BtcAccount): void {
  account.privateKey.fill(0);
  account.publicKey.fill(0);
}

export function wipeAccounts(accounts: BtcAccount[]): void {
  accounts.forEach(wipeAccount);
}
