import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptPrivateKey, encryptPrivateKey } from "../src/index.js";

describe("wallet encryption", () => {
  it("round-trips private keys without plaintext persistence fields", async () => {
    const masterKey = randomBytes(32).toString("base64");
    const privateKey = `0x${"1".repeat(64)}` as const;
    const encrypted = await encryptPrivateKey(privateKey, { masterKey });

    expect(encrypted.encryptedPrivateKey).not.toContain(privateKey);
    await expect(decryptPrivateKey(encrypted, { masterKey })).resolves.toBe(privateKey);
  });
});
