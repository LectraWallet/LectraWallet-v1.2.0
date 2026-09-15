import { describe, expect, it } from "vitest";
import {
  btcStringToSats,
  buildTransactionPlan,
  parseBitcoinUri,
  selectCoins,
  signTransactionPlan,
  validateBitcoinAddress,
  type WalletUtxo,
} from "./btc";
import {
  accountFromMnemonicBtc,
  isValidMnemonic,
  normalizeMnemonic,
  type BtcAccount,
} from "./btcWallet";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const RECIPIENT = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

function utxo(value: number, index = 0): WalletUtxo {
  return {
    txid: `${index + 1}`.padStart(64, "0"),
    vout: 0,
    value,
    status: { confirmed: true },
    account: {} as BtcAccount,
  };
}

describe("wallet compatibility", () => {
  it("derives the BIP84 reference first receive address", () => {
    const account = accountFromMnemonicBtc(MNEMONIC);
    expect(account.path).toBe("m/84'/0'/0'/0/0");
    expect(account.address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });

  it("accepts normalized valid BIP39 phrases and rejects invalid checksums", () => {
    expect(normalizeMnemonic("1. ABANDON 2. abandon\nabout")).toBe(
      "abandon abandon about"
    );
    expect(isValidMnemonic(MNEMONIC)).toBe(true);
    expect(
      isValidMnemonic(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
      )
    ).toBe(false);
  });
});

describe("address and amount validation", () => {
  it("decodes Bitcoin addresses using a network-aware checksum", () => {
    expect(validateBitcoinAddress(RECIPIENT)).toMatchObject({
      valid: true,
      type: "wpkh",
    });
    expect(
      validateBitcoinAddress("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0li").valid
    ).toBe(false);
    expect(
      validateBitcoinAddress("tb1qfmjsk2j4f9l6af62v9zd7xxwl8eukm62c8x8eh").valid
    ).toBe(false);
  });

  it("never rounds fractional bitcoin amounts", () => {
    expect(btcStringToSats("0.00000001")).toBe(1);
    expect(btcStringToSats("1.23456789")).toBe(123456789);
    expect(btcStringToSats("0.000000001")).toBe(0);
    expect(btcStringToSats("1e-8")).toBe(0);
  });

  it("extracts only the address and optional amount from a Bitcoin URI", () => {
    expect(
      parseBitcoinUri(`bitcoin:${RECIPIENT}?amount=0.001&label=ignored`)
    ).toEqual({ address: RECIPIENT, amountBtc: "0.001" });
  });
});

describe("coin selection and reviewed transaction building", () => {
  it("prefers a low-input, low-change confirmed selection", () => {
    const selection = selectCoins(
      [utxo(60_000, 0), utxo(40_000, 1), utxo(30_000, 2)],
      50_000,
      1
    );
    expect(selection.selected).toHaveLength(1);
    expect(selection.selected[0].value).toBe(60_000);
    expect(selection.changeSats).toBeGreaterThan(546);
  });

  it("folds dust change into the fee instead of creating a dust output", () => {
    const selection = selectCoins([utxo(50_000)], 49_890, 1);
    expect(selection.changeSats).toBe(0);
    expect(selection.feeSats).toBe(110);
  });

  it("builds and signs a BIP174 PSBT whose final fee matches the reviewed fee", () => {
    const source = accountFromMnemonicBtc(MNEMONIC, 0, 0);
    const change = accountFromMnemonicBtc(MNEMONIC, 0, 1);
    const plan = buildTransactionPlan({
      utxos: [{ ...utxo(100_000), account: source }],
      recipientAddress: RECIPIENT,
      amountSats: 50_000,
      feeRate: 2,
      changeAccount: change,
    });
    const signed = signTransactionPlan(plan, [source, change]);
    expect(plan.psbtBase64.length).toBeGreaterThan(50);
    expect(signed.hex).toMatch(/^[0-9a-f]+$/i);
    expect(signed.actualFeeSats).toBe(plan.feeSats);
  });
});
