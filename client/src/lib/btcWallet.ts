import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as btc from "@scure/btc-signer";
import { getBtcNetwork } from "./btcNetwork";

export interface BtcAccount { address: string; privateKey: Uint8Array; publicKey: Uint8Array; path: string; }
export function createNewMnemonic(): string { return generateMnemonic(english, 128); }
export function isValidMnemonic(value: string): boolean { const words = value.trim().split(/\s+/); return [12, 15, 18, 21, 24].includes(words.length) && validateMnemonic(value.trim(), english); }
export function accountFromMnemonicBtc(mnemonic: string): BtcAccount {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic.trim()));
  const coinType = getBtcNetwork() === "mainnet" ? 0 : 1;
  const path = `m/84'/${coinType}'/0'/0/0`;
  const child = root.derive(path);
  if (!child.privateKey) throw new Error("Failed to derive Bitcoin key.");
  const publicKey = secp256k1.getPublicKey(child.privateKey, true);
  const network = getBtcNetwork() === "mainnet" ? btc.NETWORK : btc.TEST_NETWORK;
  const payment = btc.p2wpkh(publicKey, network);
  if (!payment.address) throw new Error("Failed to derive Bitcoin address.");
  return { address: payment.address, privateKey: child.privateKey, publicKey, path };
}
