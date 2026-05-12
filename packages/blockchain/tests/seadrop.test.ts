import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import {
  createSeaDropAllowListMintPayload,
  createSeaDropPublicMintPayload,
  createSeaDropSignedMintPayload,
  OPENSEA_FEE_RECIPIENT,
  SEA_DROP_ADDRESS
} from "../src/index.ts";

const seaDropAbi = [
  {
    type: "function",
    name: "mintPublic",
    stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "mintAllowList",
    stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
      {
        name: "mintParams",
        type: "tuple",
        components: [
          { name: "mintPrice", type: "uint256" },
          { name: "maxTotalMintableByWallet", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "dropStageIndex", type: "uint256" },
          { name: "maxTokenSupplyForStage", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "restrictFeeRecipients", type: "bool" }
        ]
      },
      { name: "proof", type: "bytes32[]" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "mintSigned",
    stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
      {
        name: "mintParams",
        type: "tuple",
        components: [
          { name: "mintPrice", type: "uint256" },
          { name: "maxTotalMintableByWallet", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "dropStageIndex", type: "uint256" },
          { name: "maxTokenSupplyForStage", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "restrictFeeRecipients", type: "bool" }
        ]
      },
      { name: "salt", type: "uint256" },
      { name: "signature", type: "bytes" }
    ],
    outputs: []
  }
] as const;

const mintParams = {
  mintPriceWei: "100",
  maxTotalMintableByWallet: 2,
  startTime: 1_700_000_000,
  endTime: 1_800_000_000,
  dropStageIndex: 1,
  maxTokenSupplyForStage: 1_000,
  feeBps: 1_000,
  restrictFeeRecipients: true
};

describe("createSeaDropPublicMintPayload", () => {
  it("encodes a SeaDrop public mint transaction", () => {
    const nftContract = "0x1111111111111111111111111111111111111111";
    const minter = "0x2222222222222222222222222222222222222222";
    const payload = createSeaDropPublicMintPayload({
      nftContract,
      minter,
      mintPriceWei: "100",
      quantity: 2
    });

    expect(payload.to).toBe(SEA_DROP_ADDRESS);
    expect(payload.value).toBe(200n);

    const decoded = decodeFunctionData({ abi: seaDropAbi, data: payload.data });
    expect(decoded.functionName).toBe("mintPublic");
    expect(decoded.args).toEqual([
      nftContract,
      OPENSEA_FEE_RECIPIENT,
      minter,
      2n
    ]);
  });

  it("encodes a SeaDrop allowlist mint transaction", () => {
    const payload = createSeaDropAllowListMintPayload({
      nftContract: "0x1111111111111111111111111111111111111111",
      minter: "0x2222222222222222222222222222222222222222",
      mintParams,
      proof: ["0x3333333333333333333333333333333333333333333333333333333333333333"],
      quantity: 2
    });

    expect(payload.to).toBe(SEA_DROP_ADDRESS);
    expect(payload.value).toBe(200n);

    const decoded = decodeFunctionData({ abi: seaDropAbi, data: payload.data });
    expect(decoded.functionName).toBe("mintAllowList");
    expect(decoded.args[1]).toBe(OPENSEA_FEE_RECIPIENT);
    expect(decoded.args[3]).toBe(2n);
    expect(decoded.args[5]).toEqual([
      "0x3333333333333333333333333333333333333333333333333333333333333333"
    ]);
  });

  it("encodes a SeaDrop signed mint transaction", () => {
    const payload = createSeaDropSignedMintPayload({
      nftContract: "0x1111111111111111111111111111111111111111",
      minter: "0x2222222222222222222222222222222222222222",
      mintParams,
      salt: 9,
      signature: "0x1234",
      quantity: 1
    });

    expect(payload.value).toBe(100n);

    const decoded = decodeFunctionData({ abi: seaDropAbi, data: payload.data });
    expect(decoded.functionName).toBe("mintSigned");
    expect(decoded.args[5]).toBe(9n);
    expect(decoded.args[6]).toBe("0x1234");
  });
});
