import { Body, Controller, Get, Module, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { estimateTotalGasCost, fetchCurrentGas, presetGasSettings } from "@mint-copilot/gas-engine";
import { parseGwei } from "viem";
import { AuthGuard } from "../auth/auth.guard.js";

@Controller("gas")
@UseGuards(AuthGuard)
class GasController {
  constructor(private readonly config: ConfigService) {}

  @Get("current")
  async current(@Query("network") network: "base" | "ethereum" = "base") {
    const rpcUrl = this.config.getOrThrow<string>(network === "base" ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY");
    const gas = await fetchCurrentGas({ chainName: network, rpcUrl });
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
}

@Module({ controllers: [GasController] })
export class GasModule {}
