const CURRENT_ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 250_000;

function byteSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

const VAULT_AAD = byteSource(
  new TextEncoder().encode("Lectra Wallet encrypted vault v3")
);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const passwordBytes = byteSource(new TextEncoder().encode(password));
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: byteSource(salt),
        iterations: CURRENT_ITERATIONS,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    passwordBytes.fill(0);
  }
}

async function deriveKeyWithIterations(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  if (iterations < LEGACY_ITERATIONS || iterations > 2_000_000)
    throw new Error("Unsupported vault KDF settings.");
  const passwordBytes = byteSource(new TextEncoder().encode(password));
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: byteSource(salt), iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    passwordBytes.fill(0);
  }
}

export interface EncryptedBlob {
  version?: 2 | 3;
  kdf?: "PBKDF2-SHA-256";
  iterations?: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export function isCurrentVault(blob: EncryptedBlob): boolean {
  return (
    blob.version === 3 &&
    blob.kdf === "PBKDF2-SHA-256" &&
    blob.iterations === CURRENT_ITERATIONS
  );
}

export async function encryptSecret(
  plaintext: string,
  password: string
): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintextBytes = byteSource(new TextEncoder().encode(plaintext));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: byteSource(iv), additionalData: VAULT_AAD },
      key,
      plaintextBytes
    );
    return {
      version: 3,
      kdf: "PBKDF2-SHA-256",
      iterations: CURRENT_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
  } finally {
    salt.fill(0);
    iv.fill(0);
    plaintextBytes.fill(0);
  }
}

export async function decryptSecret(
  blob: EncryptedBlob,
  password: string
): Promise<string> {
  const legacy = blob.version === undefined || blob.version === 2;
  const iterations = legacy ? LEGACY_ITERATIONS : blob.iterations;
  if (!iterations || (blob.version !== undefined && blob.version !== 3))
    throw new Error("Unsupported vault version.");
  const salt = fromBase64(blob.salt);
  const iv = fromBase64(blob.iv);
  const ciphertext = fromBase64(blob.ciphertext);
  const key = await deriveKeyWithIterations(password, salt, iterations);
  try {
    const params: AesGcmParams = legacy
      ? { name: "AES-GCM", iv: byteSource(iv) }
      : { name: "AES-GCM", iv: byteSource(iv), additionalData: VAULT_AAD };
    const plaintext = await crypto.subtle.decrypt(params, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

export const VAULT_KDF_ITERATIONS = CURRENT_ITERATIONS;
