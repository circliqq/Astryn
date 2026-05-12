import { describe, expect, it } from "vitest";
import { OpenSeaClient, parseOpenSeaUrl } from "../src/index.ts";

describe("parseOpenSeaUrl", () => {
  it("parses drops", () => {
    expect(parseOpenSeaUrl("https://opensea.io/drops/boredapeyachtclub")).toEqual({
      kind: "drop",
      slug: "boredapeyachtclub"
    });
  });
});

describe("OpenSeaClient", () => {
  it("parses eligibility mint data from nested OpenSea responses", async () => {
    const client = new OpenSeaClient({
      apiKey: "test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            eligibility: {
              eligible: true,
              proof: ["0x3333333333333333333333333333333333333333333333333333333333333333"],
              mintParams: {
                mintPrice: "0.01",
                maxTotalMintableByWallet: 2,
                startTime: "2026-01-01T00:00:00.000Z",
                endTime: "2026-01-02T00:00:00.000Z",
                dropStageIndex: 1,
                maxTokenSupplyForStage: 1000,
                feeBps: 1000,
                restrictFeeRecipients: true
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const result = await client.checkEligibility(
      "drop",
      "0x2222222222222222222222222222222222222222",
      "allowlist"
    );

    expect(result.eligible).toBe(true);
    expect(result.proof).toHaveLength(1);
    expect(result.mintParams?.mintPriceWei).toBe("10000000000000000");
    expect(result.mintParams?.dropStageIndex).toBe("1");
  });

  it("parses transaction payloads from mint responses", async () => {
    const client = new OpenSeaClient({
      apiKey: "test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            transaction: {
              to: "0x1111111111111111111111111111111111111111",
              calldata: "0x1234",
              value: "9"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const payload = await client.getMintPayload(
      "drop",
      "0x2222222222222222222222222222222222222222",
      1,
      "gtd"
    );

    expect(payload).toEqual({
      to: "0x1111111111111111111111111111111111111111",
      data: "0x1234",
      value: 9n
    });
  });

  it("parses collection floor price from stats responses", async () => {
    const client = new OpenSeaClient({
      apiKey: "test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            total: {
              floor_price: 0.0125,
              volume: 42
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const stats = await client.getCollectionStats("drop");

    expect(stats.floorPriceEth).toBe("0.0125");
    expect(stats.totalVolumeEth).toBe("42");
  });
});
