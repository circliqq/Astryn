import { describe, expect, it } from "vitest";
import { createAppLogger } from "../src/index.ts";

function captureLogger() {
  const lines: string[] = [];
  const stream = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };

  return { lines, logger: createAppLogger(stream) };
}

describe("logger redaction", () => {
  it("redacts wallet keys, auth headers, app secrets, and nested credentials", () => {
    const { lines, logger } = captureLogger();

    logger.info(
      {
        privateKey: "0x1234567890",
        encryptedPrivateKey: "ciphertext",
        headers: {
          authorization: "Bearer lowercase",
          Authorization: "Bearer uppercase",
        },
        OPENSEA_API_KEY: "opensea-secret",
        ENCRYPTION_MASTER_KEY: "master-secret",
        nested: {
          password: "wallet-password",
          apiKey: "nested-api-key",
          authToken: "nested-auth-token",
        },
      },
      "redaction probe",
    );

    const output = lines.join("");
    expect(output).not.toContain("0x1234567890");
    expect(output).not.toContain("ciphertext");
    expect(output).not.toContain("Bearer lowercase");
    expect(output).not.toContain("Bearer uppercase");
    expect(output).not.toContain("opensea-secret");
    expect(output).not.toContain("master-secret");
    expect(output).not.toContain("wallet-password");
    expect(output).not.toContain("nested-api-key");
    expect(output).not.toContain("nested-auth-token");
    expect(output).toContain("[redacted]");
  });
});
