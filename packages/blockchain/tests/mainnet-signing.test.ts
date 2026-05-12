import { describe, expect, it } from "vitest";
import { sendRawTransaction, signTransaction } from "../src/index.ts";

const PRIVATE_KEY = `0x${"1".repeat(64)}` as const;

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("mainnet transaction guard", () => {
  it("blocks mainnet signing unless explicitly enabled", async () => {
    await withEnv(
      {
        MAINNET_SIGNING_ENABLED: undefined,
        MAINNET_TX_KILL_SWITCH: undefined,
        MAINNET_SIGNING_KILL_SWITCH: undefined,
      },
      () =>
        expect(
          signTransaction({ chainName: "ethereum", rpcUrl: "http://localhost" }, PRIVATE_KEY, {
            to: "0x0000000000000000000000000000000000000001",
            value: 0n,
            gas: 21_000n,
            nonce: 0,
          }),
        ).rejects.toThrow(/Mainnet transaction signing is disabled/),
    );
  });

  it("lets testnet signing work without the mainnet flag", async () => {
    await withEnv({ MAINNET_SIGNING_ENABLED: undefined }, async () => {
      const signed = await signTransaction(
        { chainName: "ethereum-sepolia", rpcUrl: "http://localhost" },
        PRIVATE_KEY,
        {
          to: "0x0000000000000000000000000000000000000001",
          value: 0n,
          gas: 21_000n,
          nonce: 0,
        },
      );

      expect(signed).toMatch(/^0x/);
    });
  });

  it("kill switch blocks signing and broadcast even when mainnet is enabled", async () => {
    await withEnv(
      {
        MAINNET_SIGNING_ENABLED: "true",
        MAINNET_TX_KILL_SWITCH: "true",
      },
      async () => {
        await expect(
          signTransaction({ chainName: "base", rpcUrl: "http://localhost" }, PRIVATE_KEY, {
            to: "0x0000000000000000000000000000000000000001",
            value: 0n,
            gas: 21_000n,
            nonce: 0,
          }),
        ).rejects.toThrow(/kill switch/);

        await expect(
          sendRawTransaction({ chainName: "ethereum", rpcUrl: "http://localhost" }, "0x01"),
        ).rejects.toThrow(/kill switch/);
      },
    );
  });
});
