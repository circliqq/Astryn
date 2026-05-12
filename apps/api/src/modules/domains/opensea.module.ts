import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenSeaClient } from "@mint-copilot/opensea";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";

@Injectable()
class OpenSeaService {
  private readonly client: OpenSeaClient;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenSeaClient({
      apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY"),
    });
  }

  getClient(): OpenSeaClient {
    return this.client;
  }

  getApiKey(): string {
    return this.config.getOrThrow<string>("OPENSEA_API_KEY");
  }
}

@Controller("opensea")
@UseGuards(AuthGuard)
class OpenSeaController {
  constructor(private readonly openSeaService: OpenSeaService) {}

  @Get("drops")
  async listDrops(
    @CurrentUser() _user: CurrentUserType,
    @Query("slugs") slugs?: string,
  ) {
    if (!slugs) return [];

    const client = this.openSeaService.getClient();
    const slugList = slugs.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);

    const results = await Promise.allSettled(
      slugList.map((slug) => client.getCollectionInfo(slug)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof client.getCollectionInfo>>> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  @Get("drops/:slug")
  async getDrop(
    @CurrentUser() _user: CurrentUserType,
    @Param("slug") slug: string,
  ) {
    const client = this.openSeaService.getClient();
    const [info, phases, stats] = await Promise.allSettled([
      client.getCollectionInfo(slug),
      client.getDropPhases(slug),
      client.getCollectionStats(slug),
    ]);

    return {
      collection: info.status === "fulfilled" ? info.value : null,
      phases: phases.status === "fulfilled" ? phases.value : [],
      stats: stats.status === "fulfilled" ? stats.value : null,
    };
  }

  @Get("listings/:contractAddress")
  async getListings(
    @CurrentUser() _user: CurrentUserType,
    @Param("contractAddress") contractAddress: string,
    @Query("chain") chain?: string,
    @Query("limit") limit?: string,
  ) {
    const chainParam = chain ?? "base";
    const limitParam = limit ? Math.min(Number(limit), 50) : 20;
    const apiKey = this.openSeaService.getApiKey();

    const url = `https://api.opensea.io/api/v2/orders/${chainParam}/seaport/listings?asset_contract_address=${contractAddress}&limit=${limitParam}&order_by=eth_price&order_direction=asc`;

    try {
      const res = await fetch(url, {
        headers: { "x-api-key": apiKey, accept: "application/json" },
      });
      if (!res.ok) return { listings: [], error: `OpenSea responded with ${res.status}` };
      const data = (await res.json()) as { orders?: unknown[] };
      return { listings: data.orders ?? [] };
    } catch (error) {
      return { listings: [], error: error instanceof Error ? error.message : "Failed to fetch listings." };
    }
  }

  @Get("stats/:slug")
  async getStats(
    @CurrentUser() _user: CurrentUserType,
    @Param("slug") slug: string,
  ) {
    return this.openSeaService.getClient().getCollectionStats(slug);
  }
}

@Module({
  controllers: [OpenSeaController],
  providers: [OpenSeaService],
  exports: [OpenSeaService],
})
export class OpenSeaModule {}
