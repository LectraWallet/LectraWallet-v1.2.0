import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isCurrentVault,
  VAULT_KDF_ITERATIONS,
} from "./crypto";

describe("encrypted wallet vault", () => {
  it("round-trips a recovery phrase with an authenticated current vault", async () => {
    const phrase =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const encrypted = await encryptSecret(
      phrase,
      "a sufficiently long unique password"
    );
    expect(encrypted.iterations).toBe(VAULT_KDF_ITERATIONS);
    expect(isCurrentVault(encrypted)).toBe(true);
    await expect(
      decryptSecret(encrypted, "a sufficiently long unique password")
    ).resolves.toBe(phrase);
    await expect(
      decryptSecret(encrypted, "wrong password")
    ).rejects.toBeTruthy();
  });
});
