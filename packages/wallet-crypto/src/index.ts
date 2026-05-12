import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "argon2id-aes-256-gcm-v1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

export interface EncryptedPrivateKey {
  encryptedPrivateKey: string;
  encryptionSalt: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  encryptionVersion: string;
}

export interface WalletEncryptionOptions {
  masterKey: string;
}

function assertMasterKey(masterKey: string): Buffer {
  const material = Buffer.from(masterKey, "base64");
  if (material.byteLength < KEY_LENGTH) {
    throw new Error("ENCRYPTION_MASTER_KEY must be base64 and at least 32 bytes.");
  }
  return material.subarray(0, KEY_LENGTH);
}

async function deriveKey(masterKey: string, salt: Buffer): Promise<Buffer> {
  const root = assertMasterKey(masterKey);
  const encoded = await argon2.hash(root, {
    type: argon2.argon2id,
    salt,
    raw: true,
    hashLength: KEY_LENGTH,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1
  });
  root.fill(0);
  return Buffer.from(encoded);
}

export async function encryptPrivateKey(
  privateKey: `0x${string}`,
  options: WalletEncryptionOptions
): Promise<EncryptedPrivateKey> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(options.masterKey, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(VERSION));

  const plaintext = Buffer.from(privateKey, "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  plaintext.fill(0);
  key.fill(0);

  return {
    encryptedPrivateKey: encrypted.toString("base64"),
    encryptionSalt: salt.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionAuthTag: authTag.toString("base64"),
    encryptionVersion: VERSION
  };
}

export async function decryptPrivateKey(
  encrypted: EncryptedPrivateKey,
  options: WalletEncryptionOptions
): Promise<`0x${string}`> {
  if (encrypted.encryptionVersion !== VERSION) {
    throw new Error(`Unsupported wallet encryption version: ${encrypted.encryptionVersion}`);
  }

  const salt = Buffer.from(encrypted.encryptionSalt, "base64");
  const iv = Buffer.from(encrypted.encryptionIv, "base64");
  const authTag = Buffer.from(encrypted.encryptionAuthTag, "base64");
  const key = await deriveKey(options.masterKey, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(VERSION));
  decipher.setAuthTag(authTag);

  const ciphertext = Buffer.from(encrypted.encryptedPrivateKey, "base64");
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const privateKey = plaintext.toString("utf8") as `0x${string}`;

  key.fill(0);
  plaintext.fill(0);
  return privateKey;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}
