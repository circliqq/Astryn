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
// Proxy-enabled fetch using Node's built-in undici ProxyAgent.
// Only active when PROXY_URL is set in .env
function buildProxyFetch(proxyUrl: string): typeof fetch {
  // undici ships with Node 18+ — no extra install needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProxyAgent, fetch: undiciFetch } = require("undici") as {
    ProxyAgent: new (url: string) => object;
    fetch: typeof fetch;
  };
  const dispatcher = new ProxyAgent(proxyUrl);
  return (input, init) =>
    undiciFetch(input as Parameters<typeof fetch>[0], {
      ...(init ?? {}),
      // @ts-expect-error dispatcher is undici-specific
      dispatcher,
    }) as ReturnType<typeof fetch>;
}

@Injectable()
class OpenSeaService {
  private readonly client: OpenSeaClient;
  private readonly proxyFetch: typeof fetch | undefined;

  constructor(private readonly config: ConfigService) {
    const proxyUrl = this.config.get<string>("PROXY_URL");
    this.proxyFetch = proxyUrl ? buildProxyFetch(proxyUrl) : undefined;

    this.client = new OpenSeaClient({
      apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY"),
      ...(this.proxyFetch ? { fetchImpl: this.proxyFetch } : {}),
    });
  }

  getClient(): OpenSeaClient {
    return this.client;
  }

  getApiKey(): string {
    return this.config.getOrThrow<string>("OPENSEA_API_KEY");
  }

  /** Returns proxy-aware fetch (falls back to global fetch if no proxy configured). */
  getFetch(): typeof fetch {
    return this.proxyFetch ?? fetch;
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
    const proxyFetch = this.openSeaService.getFetch();

    try {
      const res = await proxyFetch(url, {
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
