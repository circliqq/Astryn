import { Body, Controller, Get, Module, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { estimateTotalGasCost, fetchCurrentGas, presetGasSettings } from "@mint-copilot/gas-engine";
import {
  createSeaDropPublicMintPayload,
  estimateMintGas,
  type ChainName,
} from "@mint-copilot/blockchain";
import { parseGwei } from "viem";
import { AuthGuard } from "../auth/auth.guard.js";

/** Buffer multiplier applied on top of raw eth_estimateGas result. */
const GAS_ESTIMATE_BUFFER = 1.2;

interface SimulateMintBody {
  contractAddress: string;
  walletAddress: string;
  network: "base" | "ethereum";
  priceWei: string;
  quantity?: number;
}

interface SimulateMintResult {
  estimatedGas: number;
  recommendedLimit: number;
  bufferMultiplier: number;
  simulated: true;
}

interface SimulateMintFallback {
  estimatedGas: null;
  recommendedLimit: number;
  bufferMultiplier: number;
  simulated: false;
  reason: string;
}

@Controller("gas")
@UseGuards(AuthGuard)
class GasController {
  constructor(private readonly config: ConfigService) {}

  @Get("current")
  async current(@Query("network") network: "base" | "ethereum" = "base") {
    const rpcUrl = this.config.getOrThrow<string>(network === "base" ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY");
    const gas = await Promise.race([
      fetchCurrentGas({ chainName: network, rpcUrl }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gas fetch timed out after 5000ms")), 5_000)
      ),
    ]);
    return {
      baseFeePerGas: gas.baseFeePerGas.toString(),
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas.toString(),
      maxFeePerGas: gas.maxFeePerGas.toString()
    };
  }

  @Post("estimate")
  estimate(@Body() body: { gasUnits: string; maxFeeGwei: string; mode?: "safe" | "balanced" | "aggressive" }) {
    const settings = presetGasSettings(body.mode ?? "balanced");
    return estimateTotalGasCost(BigInt(body.gasUnits), parseGwei(body.maxFeeGwei), settings);
  }

  /**
   * Simulate a SeaDrop public mint against the live chain to get a precise
   * gas estimate for a given contract + wallet pair.
   *
   * Falls back gracefully when the contract reverts (e.g. phase not started,
   * wallet not eligible) — returns a phase-aware heuristic instead.
   */
  @Post("simulate-mint")
  async simulateMint(
    @Body() body: SimulateMintBody,
  ): Promise<SimulateMintResult | SimulateMintFallback> {
    const rpcUrl = this.config.getOrThrow<string>(
      body.network === "base" ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY",
    );
    const chainName = body.network as ChainName;
    const quantity = Math.max(1, body.quantity ?? 1);

    const payload = createSeaDropPublicMintPayload({
      nftContract: body.contractAddress as `0x${string}`,
      minter: body.walletAddress as `0x${string}`,
      mintPriceWei: BigInt(body.priceWei ?? "0"),
      quantity,
    });

    try {
      const rawGas = await estimateMintGas(
        { chainName, rpcUrl },
        {
          account: body.walletAddress as `0x${string}`,
          to: payload.to,
          data: payload.data,
          value: payload.value,
        },
      );

      const estimated = Number(rawGas);
      const recommended = roundToNearest1k(estimated * GAS_ESTIMATE_BUFFER);

      return {
        estimatedGas: estimated,
        recommendedLimit: recommended,
        bufferMultiplier: GAS_ESTIMATE_BUFFER,
        simulated: true,
      };
    } catch (err: unknown) {
      // Contract reverted (phase not live, not eligible, etc.)
      // Return a heuristic based on known SeaDrop public mint gas usage.
      const reason =
        err instanceof Error ? err.message.slice(0, 120) : "Simulation reverted";

      return {
        estimatedGas: null,
        recommendedLimit: 200_000,
        bufferMultiplier: GAS_ESTIMATE_BUFFER,
        simulated: false,
        reason,
      };
    }
  }
}

/** Round n up to the nearest 1 