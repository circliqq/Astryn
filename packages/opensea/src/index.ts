import type { MintPhaseType, SupportedNetwork } from "@mint-copilot/shared";

export interface ParsedOpenSeaUrl {
  kind: "drop" | "collection";
  slug: string;
}

export interface DropPhase {
  id: string;
  type: MintPhaseType;
  name?: string;
  priceEth: string;
  startTime: string;
  endTime?: string;
  maxMintPerWallet?: number;
  mintParams?: OpenSeaMintParams;
}

export interface CollectionInfo {
  slug: string;
  name: string;
  imageUrl?: string;
  chain: SupportedNetwork;
  contractAddress: `0x${string}`;
  supply?: number;
  phases: DropPhase[];
}

export interface CollectionMarketStats {
  floorPriceEth?: string;
  bestOfferEth?: string;
  oneDayVolumeEth?: string;
  totalVolumeEth?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  phaseType: MintPhaseType;
  reason?: string;
  proof?: string[];
  mintParams?: OpenSeaMintParams;
  salt?: string;
  signature?: `0x${string}`;
  payload?: MintPayload;
}

export interface DropEligibilityStage {
  stage: string;
  stageType: string;
  stageIndex: number | null;
  maxMint: number;
}

export interface DropEligibilityStagesResult {
  address: string;
  stages: DropEligibilityStage[];
}

export interface MintPayload {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

export interface OpenSeaMintParams {
  mintPriceWei: string;
  maxTotalMintableByWallet: string;
  startTime: string;
  endTime: string;
  dropStageIndex: string;
  maxTokenSupplyForStage: string;
  feeBps: string;
  restrictFeeRecipients: boolean;
}

export interface SeaportItem {
  itemType: number;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
}

export interface SeaportConsiderationItem extends SeaportItem {
  recipient: string;
}

export interface SeaportOrderParameters {
  offerer: string;
  zone: string;
  offer: SeaportItem[];
  consideration: SeaportConsiderationItem[];
  orderType: number;
  startTime: string;
  endTime: string;
  zoneHash: string;
  salt: string;
  conduitKey: string;
  counter: string;
  totalOriginalConsiderationItems: number;
}

export interface OpenSeaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function parseOpenSeaUrl(rawUrl: string): ParsedOpenSeaUrl {
  const url = new URL(rawUrl);
  if (!url.hostname.endsWith("opensea.io")) throw new Error("Only OpenSea URLs are supported.");

  const parts = url.pathname.split("/").filter(Boolean);
  const dropsIndex = parts.findIndex((part) => part === "drops");
  if (dropsIndex >= 0 && parts[dropsIndex + 1]) {
    return { kind: "drop", slug: parts[dropsIndex + 1] };
  }

  const collectionIndex = parts.findIndex((part) => part === "collection");
  if (collectionIndex >= 0 && parts[collectionIndex + 1]) {
    return { kind: "collection", slug: parts[collectionIndex + 1] };
  }

  throw new Error("Could not find an OpenSea drop or collection slug.");
}

export class OpenSeaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(private readonly options: OpenSeaClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.opensea.io/api/v2";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async scanDrop(url: string): Promise<CollectionInfo> {
    const parsed = parseOpenSeaUrl(url);
    const info = await this.getCollectionInfo(parsed.slug);
    const phases = await this.getDropPhases(parsed.slug);
    return { ...info, phases };
  }

  async scanDropByContract(contractAddress: string, chain: "ethereum" | "base"): Promise<CollectionInfo> {
    // Resolve slug from contract address via OpenSea API
    let slug: string | undefined;
    try {
      const data = await this.request<Record<string, unknown>>(
        `/chain/${chain}/contract/${contractAddress}`
      );
      slug = typeof data.collection === "string" ? data.collection : undefined;
    } catch {
      // If the direct contract lookup fails, fall through to slug-less error below
    }

    if (!slug) {
      throw new Error(
        `No collection found on OpenSea for contract ${contractAddress} on ${chain}. Make sure the contract is listed on OpenSea.`
      );
    }

    const info = await this.getCollectionInfo(slug);
    const phases = await this.getDropPhases(slug);
    return { ...info, phases };
  }

  async getCollectionInfo(slug: string): Promise<CollectionInfo> {
    const data = await this.request<Record<string, unknown>>(`/collections/${slug}`);
    const contracts = (data.contracts as Array<Record<string, unknown>> | undefined) ?? [];
    const firstContract = contracts[0] ?? {};

    return {
      slug,
      name: String(data.name ?? slug),
      imageUrl: typeof data.image_url === "string" ? data.image_url : undefined,
      chain: this.normalizeChain(String(firstContract.chain ?? data.chain ?? "base")),
      contractAddress: String(firstContract.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
      supply: Number(data.total_supply ?? 0),
      phases: []
    };
  }

  /**
   * Market snapshot for the scanner: floor, top offer, 24h volume, total sales,
   * and holder count. Best-effort — missing fields come back undefined.
   */
  async getCollectionMarket(slug: string): Promise<{
    floorEth?: string;
    topOfferEth?: string;
    volume24hEth?: string;
    salesCount?: number;
    holders?: number;
  }> {
    let stats: CollectionMarketStats | undefined;
    try {
      stats = await this.getCollectionStats(slug);
    } catch {
      stats = undefined;
    }

    let salesCount: number | undefined;
    let holders: number | undefined;
    try {
      const data = await this.request<Record<string, unknown>>(`/collections/${slug}/stats`);
      const total = (data.total as Record<string, unknown> | undefined) ?? {};
      const sales = Number(total.sales ?? data.total_sales ?? (data as Record<string, unknown>).sales);
      if (Number.isFinite(sales)) salesCount = sales;
      const owners = Number(total.num_owners ?? (data as Record<string, unknown>).num_owners);
      if (Number.isFinite(owners)) holders = owners;
    } catch {
      /* ignore */
    }

    return {
      floorEth: stats?.floorPriceEth,
      topOfferEth: stats?.bestOfferEth,
      volume24hEth: stats?.oneDayVolumeEth,
      salesCount,
      holders,
    };
  }

  /** Resolve an OpenSea collection slug from a contract address (or null). */
  async slugByContract(
    contractAddress: string,
    chain: "ethereum" | "base",
  ): Promise<string | null> {
    try {
      const data = await this.request<Record<string, unknown>>(
        `/chain/${chain}/contract/${contractAddress}`,
      );
      return typeof data.collection === "string" ? data.collection : null;
    } catch {
      return null;
    }
  }

  /**
   * Trust signals for scam scoring: OpenSea safelist/verified status + whether
   * the collection has social links (Twitter / Discord / website).
   */
  async getCollectionTrust(slug: string): Promise<{
    verified: boolean;
    hasTwitter: boolean;
    hasDiscord: boolean;
    hasWebsite: boolean;
    safelistStatus?: string;
    supply?: number;
    name?: string;
    imageUrl?: string;
  }> {
    const data = await this.request<Record<string, unknown>>(`/collections/${slug}`);
    const safelist = String(
      data.safelist_status ?? data.safelist_request_status ?? "",
    ).toLowerCase();
    const verified = ["verified", "approved"].includes(safelist);
    const str = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
    return {
      verified,
      hasTwitter: Boolean(str(data.twitter_username)),
      hasDiscord: Boolean(str(data.discord_url)),
      hasWebsite: Boolean(str(data.project_url) ?? str(data.external_url)),
      safelistStatus: safelist || undefined,
      supply: Number(data.total_supply ?? 0) || undefined,
      name: str(data.name),
      imageUrl: str(data.image_url),
    };
  }

  async getCollectionStats(slug: string): Promise<CollectionMarketStats> {
    const [data, bestOfferEth] = await Promise.all([
      this.request<Record<string, unknown>>(`/collections/${slug}/stats`),
      this.fetchBestOfferEth(slug),
    ]);
    return {
      floorPriceEth: ethStatFrom(data, [
        ["total", "floor_price"],
        ["total", "floorPrice"],
        ["stats", "floor_price"],
        ["stats", "floorPrice"],
        ["floor_price"],
        ["floorPrice"],
        ["floor"]
      ]),
      bestOfferEth: bestOfferEth ?? ethStatFrom(data, [
        ["total", "top_bid"],
        ["total", "topBid"],
        ["stats", "top_bid"],
        ["top_bid"],
        ["topBid"],
      ]),
      oneDayVolumeEth: ethStatFrom(data, [
        ["intervals", "one_day", "volume"],
        ["intervals", "oneDay", "volume"],
        ["one_day", "volume"],
        ["oneDayVolume"],
        ["one_day_volume"]
      ]),
      totalVolumeEth: ethStatFrom(data, [
        ["total", "volume"],
        ["stats", "total_volume"],
        ["total_volume"],
        ["totalVolume"]
      ])
    };
  }

  // Fetch the best collection-wide offer from OpenSea's offers endpoint.
  // Returns ETH value as string, or undefined if unavailable.
  private async fetchBestOfferEth(slug: string): Promise<string | undefined> {
    try {
      const data = await this.request<Record<string, unknown>>(
        `/offers/collection/${slug}/best`,
      );
      // Response shape: { price: { value: "...", decimals: 18 } } or { current_price: "..." }
      const price = isRecord(data.price) ? data.price : null;
      if (price) {
        const value = price.value ?? price.amount;
        const decimals = typeof price.decimals === "number" ? price.decimals : 18;
        if (typeof value === "string" || typeof value === "number") {
          const eth = Number(value) / Math.pow(10, decimals);
          return eth.toString();
        }
      }
      // Fallback: current_price in wei
      if (typeof data.current_price === "string") {
        return (Number(data.current_price) / 1e18).toString();
      }
    } catch { /* best-effort — non-fatal */ }
    return undefined;
  }

  async getDropPhases(slug: string): Promise<DropPhase[]> {
    // Try /drops/{slug} — OpenSea seadrop v1/v2 endpoint with stages array
    try {
      const data = await this.request<Record<string, unknown>>(`/drops/${slug}`);
      const stages = Array.isArray(data.stages) ? data.stages : Array.isArray(data.phases) ? data.phases : [];
      if (stages.length > 0) {
        return stages.flatMap((stage, index) => {
          const item = stage as Record<string, unknown>;
          // price is in wei (e.g. "2200000000000000"), convert to ETH string
          const priceWei = String(item.price ?? "0");
          const priceEth = (Number(BigInt(priceWei)) / 1e18).toString();
          const maxPerWallet = item.max_per_wallet != null ? Number(item.max_per_wallet) : undefined;
          const startTime = dateStringFrom(item, ["start_time", "startTime", "start_date", "startDate", "starts_at", "startsAt"]);
          if (!startTime) return [];
          const rawName = String(item.name ?? item.title ?? item.stage_name ?? item.label ?? "");
          return {
            id: String(item.uuid ?? item.id ?? `${slug}-${index}`),
            type: this.normalizePhase(
              String(item.stage_type ?? item.type ?? item.phase_type ?? "public"),
              rawName,
            ),
            name: rawName || undefined,
            priceEth,
            startTime,
            endTime: dateStringFrom(item, ["end_time", "endTime", "end_date", "endDate", "ends_at", "endsAt"]),
            maxMintPerWallet: maxPerWallet && maxPerWallet > 0 ? maxPerWallet : undefined,
            mintParams: mintParamsFrom(item)
          };
        });
      }
    } catch { /* fall through */ }

    // Fallback: /drops/{slug}/phases
    try {
      const data = await this.request<Record<string, unknown>>(`/drops/${slug}/phases`);
      const phases = Array.isArray(data.phases) ? data.phases : [];
      return phases.flatMap((phase, index) => {
        const item = phase as Record<string, unknown>;
        const startTime = dateStringFrom(item, ["start_time", "startTime", "start_date", "startDate", "starts_at", "startsAt"]);
        if (!startTime) return [];
        const rawName = String(item.name ?? item.title ?? item.stage_name ?? item.label ?? "");
        return {
          id: String(item.id ?? `${slug}-${index}`),
          type: this.normalizePhase(String(item.type ?? item.phase_type ?? "public"), rawName),
          name: rawName || undefined,
          priceEth: String(item.price_eth ?? item.price ?? "0"),
          startTime,
          endTime: dateStringFrom(item, ["end_time", "endTime", "end_date", "endDate", "ends_at", "endsAt"]),
          maxMintPerWallet: item.max_mint_per_wallet != null ? Number(item.max_mint_per_wallet) : undefined,
          mintParams: mintParamsFrom(item)
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Verify eligibility through OpenSea's internal authenticated GraphQL API
   * (opensea.io SIWE login → gql.opensea.io DropEligibilityQuery). Mirrors the
   * flow the OpenSea website itself uses, so it works for SeaDrop GTD / presale /
   * allowlist drops that have no public REST eligibility endpoint.
   *
   * Returns an EligibilityResult when eligibility is definitively known, or null
   * when it could not be determined (caller should fall back to REST endpoints).
   */
  private async eligibilityViaGraphQL(
    slug: string,
    walletAddress: string,
    phaseType: MintPhaseType,
    signMessage: (message: string) => Promise<string>
  ): Promise<EligibilityResult | null> {
    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const cookies = new Map<string, string>();
    const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const storeCookies = (res: Response) => {
      const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const list = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
      for (const sc of list) {
        const pair = sc.split(";")[0] ?? "";
        const idx = pair.indexOf("=");
        if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    };
    // NOTE: do NOT include x-api-key here — these are browser-facing opensea.io /
    // gql.opensea.io endpoints, not api.opensea.io. Sending the API key causes
    // Cloudflare to reject the request with 403 before SIWE can complete.
    const baseHeaders: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      "user-agent": UA,
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      origin: "https://opensea.io",
      referer: "https://opensea.io/"
    };

    const send = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const headers: Record<string, string> = { ...baseHeaders, ...(init?.headers ?? {}) };
      if (cookies.size) headers.cookie = cookieHeader();
      return this.fetchImpl(url, { method: init?.method ?? "GET", headers, body: init?.body }).then(async (res) => {
        storeCookies(res);
        return res;
      });
    };

    // 1) warm-up (collect Cloudflare cookies)
    await send("https://opensea.io");

    // 2) nonce
    const nonceRes = await send("https://opensea.io/__api/auth/siwe/nonce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: ""
    });
    if (!nonceRes.ok) return null;
    const nonce = (await nonceRes.json().catch(() => null))?.nonce as string | undefined;
    if (!nonce) return null;

    // 3) build + sign SIWE message (must match OpenSea's exact format)
    const issuedAt = new Date().toISOString();
    const statement =
      "Click to sign in and accept the OpenSea Terms of Service " +
      "(https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).";
    const address = walletAddress;
    const siweMessage =
      `opensea.io wants you to sign in with your account:\n` +
      `${address}\n\n` +
      `${statement}\n\n` +
      `URI: https://opensea.io/\n` +
      `Version: 1\n` +
      `Chain ID: 1\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`;
    let signature = await signMessage(siweMessage);
    if (!signature.startsWith("0x")) signature = `0x${signature}`;

    // 4) verify (establish authenticated session)
    const verifyRes = await send("https://opensea.io/__api/auth/siwe/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainArch: "EVM",
        message: {
          address,
          chainId: "1",
          domain: "opensea.io",
          issuedAt,
          nonce,
          statement,
          uri: "https://opensea.io/",
          version: "1"
        },
        signature
      })
    });
    if (!verifyRes.ok) return null;

    // 5) DropEligibilityQuery
    cookies.set("connected-account-server-hint", address.toLowerCase());
    const query =
      `query DropEligibilityQuery($collectionSlug: String!, $address: Address!) {\n` +
      `  dropBySlug(slug: $collectionSlug) {\n` +
      `    __typename\n` +
      `    stages {\n` +
      `      stageType\n      stageIndex\n      isEligible\n` +
      `      eligibleMaxTotalMintableByWallet\n      __typename\n    }\n  }\n}`;
    const gqlRes = await send("https://gql.opensea.io/graphql", {
      method: "POST",
      // gql.opensea.io is a different origin — update sec-fetch-site accordingly
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
        referer: "https://opensea.io/"
      },
      body: JSON.stringify({
        operationName: "DropEligibilityQuery",
        query,
        variables: { address, collectionSlug: slug }
      })
    });
    if (!gqlRes.ok) return null;
    const json = (await gqlRes.json().catch(() => null)) as
      | { data?: { dropBySlug?: { stages?: Array<Record<string, unknown>> } }; errors?: unknown }
      | null;
    if (!json || json.errors) return null;
    const drop = json.data?.dropBySlug;
    if (!drop) return null;

    const stages = Array.isArray(drop.stages) ? drop.stages : [];
    const eligibleStages = stages
      .filter((s) => Boolean(s.isEligible) && s.stageType !== "PUBLIC_SALE")
      .map((s) => {
        const type = typeof s.stageType === "string" ? s.stageType : "STAGE";
        const idx = s.stageIndex;
        const name = idx != null ? `${type}#${idx}` : type;
        const max = Number(s.eligibleMaxTotalMintableByWallet ?? 0);
        return { name, max };
      });

    if (eligibleStages.length > 0) {
      const detail = eligibleStages.map((s) => `${s.name}(${s.max})`).join(", ");
      return {
        eligible: true,
        phaseType,
        reason: `Wallet is eligible (OpenSea DropEligibilityQuery): ${detail}.`
      };
    }
    return {
      eligible: false,
      phaseType,
      reason: "Wallet is not eligible for any non-public stage (OpenSea DropEligibilityQuery)."
    };
  }

  async checkEligibility(
    slug: string,
    walletAddress: string,
    phaseType: MintPhaseType,
    options?: {
      chain?: string;
      contractAddress?: string;
      /**
       * EIP-191 personal_sign callback for the wallet being checked. When provided,
       * eligibility is verified via OpenSea's authenticated GraphQL DropEligibilityQuery
       * (the same source the OpenSea website uses) — this is the only reliable path for
       * SeaDrop GTD / allowlist drops whose public REST endpoints return 404.
       */
      signMessage?: (message: string) => Promise<string>;
    }
  ): Promise<EligibilityResult> {
    const chain = options?.chain?.toLowerCase() ?? "ethereum";
    const contract = options?.contractAddress;

    // ── Phase 0: authenticated GraphQL DropEligibilityQuery (most reliable) ────
    // Only runs when a signMessage callback is supplied (i.e. we have the wallet key).
    if (options?.signMessage) {
      try {
        const gqlResult = await this.eligibilityViaGraphQL(slug, walletAddress, phaseType, options.signMessage);
        if (gqlResult) return gqlResult;
        // gqlResult === null → could not determine; fall through to REST phases.
      } catch {
        // Network/Cloudflare/SIWE failure → fall through to REST phases.
      }
    }

    // ── Phase 1: try GET eligibility endpoints ────────────────────────────────
    const getEndpoints = [
      `/drops/${slug}/eligibility?wallet_address=${walletAddress}&phase_type=${phaseType}`,
      `/drops/${slug}/eligibility?wallet_address=${walletAddress}`,
      `/drops/${slug}/eligibility?wallet=${walletAddress}&phase=${phaseType}`,
      `/drops/${slug}/eligibility/${walletAddress}?phase=${phaseType}`,
      `/drops/${slug}/allowlist?wallet_address=${walletAddress}`,
      // Drop data with wallet — some collections embed eligibility here
      `/drops/${slug}?wallet_address=${walletAddress}`,
      // Chain + contract specific endpoints (Seadrop v2 / ERC721C)
      ...(contract ? [
        `/chain/${chain}/contract/${contract}/drops/eligibility?wallet_address=${walletAddress}&phase_type=${phaseType}`,
        `/chain/${chain}/contract/${contract}/drops/eligibility?wallet_address=${walletAddress}`,
        `/chain/${chain}/contract/${contract}/drops/allowlist?wallet_address=${walletAddress}`,
        `/chain/${chain}/contract/${contract}/seadrop/allowlist?wallet_address=${walletAddress}`,
      ] : []),
    ];

    let data: Record<string, unknown> | null = null;

    for (const endpoint of getEndpoints) {
      try {
        data = await this.request<Record<string, unknown>>(endpoint);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Only continue to the next endpoint on 404; surface other errors (429, 5xx) immediately.
        if (!msg.includes("404")) throw err;
      }
    }

    // ── Phase 2: GET endpoints all returned 404 — try POST /mint as a dry-run ──
    // For signed-mint allowlists (Seadrop v2 / ERC721C), OpenSea's backend only
    // returns signed calldata when the wallet is on the allowlist.
    // An "not eligible" error → confirmed not eligible.
    // A successful response with payload → confirmed eligible.
    // Any other error → still unverifiable.
    if (!data) {
      try {
        // Use the exact body format from OpenSea's official docs:
        // https://docs.opensea.io/docs/mint-from-a-drop
        const mintData = await this.request<Record<string, unknown>>(`/drops/${slug}/mint`, {
          method: "POST",
          body: JSON.stringify({
            wallet_address: walletAddress,
            quantity: 1,
          }),
        });
        // If we get here, the wallet is eligible — OpenSea returned mint data.
        const payload = mintPayloadFrom(mintData);
        const proof = stringArrayFrom(mintData, [["proof"], ["merkle_proof"], ["merkleProof"]]);
        const signature = hexStringFrom(mintData, [["signature"], ["signed_mint", "signature"]]);
        return {
          eligible: true,
          phaseType,
          reason: "Wallet is eligible (mint data obtained from OpenSea).",
          payload,
          proof,
          signature,
        };
      } catch (mintErr) {
        const mintMsg = mintErr instanceof Error ? mintErr.message : String(mintErr);
        const mintMsgLower = mintMsg.toLowerCase();

        // Only trust EXPLICIT eligibility keywords — not raw HTTP status codes.
        // A 400 from an UPCOMING phase means "phase not started yet", NOT "wallet not eligible".
        // Treating any 4xx as ineligible causes false negatives for upcoming phases.
        const confirmedNotEligible =
          mintMsgLower.includes("not eligible") ||
          mintMsgLower.includes("not whitelisted") ||
          mintMsgLower.includes("not allowlisted") ||
          mintMsgLower.includes("not in allowlist") ||
          mintMsgLower.includes("not on the allowlist") ||
          mintMsgLower.includes("not on allowlist") ||
          mintMsgLower.includes("address not") ||
          mintMsgLower.includes("ineligible") ||
          mintMsgLower.includes("unauthorized");

        if (confirmedNotEligible) {
          return {
            eligible: false,
            phaseType,
            reason: mintMsg,
          };
        }
        // Mint endpoint also 404'd or returned a 5xx / ambiguous error.
        // Fall through to Phase 3.
      }
    }

    // ── Phase 3: try fetching the full allowlist and scanning for the wallet ──
    // Some collections expose the allowlist as a paginated list of addresses.
    const allowlistEndpoints = [
      `/drops/${slug}/allowlist`,
      `/drops/${slug}/allowlist?limit=1000`,
      ...(contract ? [
        `/chain/${chain}/contract/${contract}/drops/allowlist`,
        `/chain/${chain}/contract/${contract}/drops/allowlist?limit=1000`,
      ] : []),
    ];

    for (const endpoint of allowlistEndpoints) {
      try {
        const listData = await this.request<Record<string, unknown>>(endpoint);
        // Look for a list of addresses in the response
        const addresses = this.extractAddressList(listData);
        if (addresses.length > 0) {
          const lower = walletAddress.toLowerCase();
          const eligible = addresses.some((a) => a.toLowerCase() === lower);
          return {
            eligible,
            phaseType,
            reason: eligible
              ? "Wallet found in OpenSea allowlist."
              : "Wallet not found in OpenSea allowlist.",
          };
        }
      } catch {
        // continue
      }
    }

    // ── Phase 4: try stage-specific eligibility (uses drop stages to get IDs) ──
    try {
      const dropData = await this.request<Record<string, unknown>>(`/drops/${slug}`);
      const stages = Array.isArray(dropData.stages) ? dropData.stages : Array.isArray(dropData.phases) ? dropData.phases : [];
      for (const stage of stages as Record<string, unknown>[]) {
        const stageId = stage.uuid ?? stage.id ?? stage.stage_id;
        if (!stageId) continue;
        const stageEndpoints = [
          `/drops/${slug}/stages/${stageId}/eligibility?wallet_address=${walletAddress}`,
          `/drops/${slug}/stages/${stageId}?wallet_address=${walletAddress}`,
          `/drops/${slug}/phases/${stageId}/eligibility?wallet_address=${walletAddress}`,
        ];
        for (const ep of stageEndpoints) {
          try {
            const stageData = await this.request<Record<string, unknown>>(ep);
            const eligible =
              booleanFrom(stageData, [["eligible"], ["is_eligible"], ["isEligible"]]) ??
              Boolean(mintPayloadFrom(stageData) ?? stringArrayFrom(stageData, [["proof"]]));
            return { eligible, phaseType, reason: eligible ? "Wallet is eligible." : "Wallet is not eligible." };
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (!m.includes("404")) throw e;
          }
        }
      }
    } catch {
      // ignore
    }

    // All approaches exhausted — truly unverifiable.
    if (!data) {
      throw new Error("404: OpenSea eligibility could not be verified for this phase. Check manually on opensea.io.");
    }

    const payload = mintPayloadFrom(data);
    const proof = stringArrayFrom(data, [
      ["proof"],
      ["merkle_proof"],
      ["merkleProof"],
      ["allowlist", "proof"],
      ["eligibility", "proof"],
      ["mint", "proof"]
    ]);
    const signature = hexStringFrom(data, [
      ["signature"],
      ["signed_mint", "signature"],
      ["signedMint", "signature"],
      ["mint", "signature"]
    ]);
    const mintParams = mintParamsFrom(data);
    const eligible =
      booleanFrom(data, [
        ["eligible"],
        ["is_eligible"],
        ["isEligible"],
        ["eligibility", "eligible"],
        ["result", "eligible"]
      ]) ??
      Boolean(payload ?? proof?.length ?? signature);

    return {
      eligible,
      phaseType,
      reason: stringFrom(data, [["reason"], ["message"], ["eligibility", "reason"]]),
      proof,
      mintParams,
      salt: stringFrom(data, [["salt"], ["signed_mint", "salt"], ["signedMint", "salt"], ["mint", "salt"]]),
      signature,
      payload
    };
  }

  async postSeaportListing(
    chain: "ethereum" | "base",
    parameters: SeaportOrderParameters,
    signature: string,
  ): Promise<void> {
    await this.request<unknown>(`/orders/${chain}/seaport/listings`, {
      method: "POST",
      body: JSON.stringify({ parameters, signature }),
    });
  }

  async checkDropEligibilityStages(
    slug: string,
    walletAddress: string,
    signMessage: (message: string) => Promise<string>
  ): Promise<DropEligibilityStagesResult> {
    const UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const cookies = new Map<string, string>();
    const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const storeCookies = (res: Response) => {
      const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const list = typeof getSetCookie === "function" ? getSetCookie.call(res.headers) : [];
      for (const sc of list) {
        const pair = sc.split(";")[0] ?? "";
        const idx = pair.indexOf("=");
        if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    };
    const baseHeaders: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      "user-agent": UA,
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      origin: "https://opensea.io",
      referer: "https://opensea.io/"
    };

    const send = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const headers: Record<string, string> = { ...baseHeaders, ...(init?.headers ?? {}) };
      if (cookies.size) headers.cookie = cookieHeader();
      return this.fetchImpl(url, { method: init?.method ?? "GET", headers, body: init?.body }).then(async (res) => {
        storeCookies(res);
        return res;
      });
    };

    await send("https://opensea.io");

    const nonceRes = await send("https://opensea.io/__api/auth/siwe/nonce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: ""
    });
    if (!nonceRes.ok) throw new Error(`OpenSea nonce request failed with ${nonceRes.status}.`);
    const nonce = (await nonceRes.json().catch(() => null))?.nonce as string | undefined;
    if (!nonce) throw new Error("OpenSea nonce response did not include a nonce.");

    const issuedAt = new Date().toISOString();
    const statement =
      "Click to sign in and accept the OpenSea Terms of Service " +
      "(https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).";
    const address = walletAddress;
    const siweMessage =
      `opensea.io wants you to sign in with your account:\n` +
      `${address}\n\n` +
      `${statement}\n\n` +
      `URI: https://opensea.io/\n` +
      `Version: 1\n` +
      `Chain ID: 1\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`;
    let signature = await signMessage(siweMessage);
    if (!signature.startsWith("0x")) signature = `0x${signature}`;

    const verifyRes = await send("https://opensea.io/__api/auth/siwe/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainArch: "EVM",
        message: {
          address,
          chainId: "1",
          domain: "opensea.io",
          issuedAt,
          nonce,
          statement,
          uri: "https://opensea.io/",
          version: "1"
        },
        signature
      })
    });
    if (!verifyRes.ok) throw new Error(`OpenSea SIWE verify failed with ${verifyRes.status}.`);

    cookies.set("connected-account-server-hint", address.toLowerCase());
    const query = `query DropEligibilityQuery($collectionSlug: String!, $address: Address!) {
  dropBySlug(slug: $collectionSlug) {
    __typename
    ... on Erc721SeaDropV1 {
      minterQuantityMinted(minter: $address)
      __typename
    }
    stages {
      stageType
      stageIndex
      isEligible
      maxTotalMintableByWallet
      eligibleMaxTotalMintableByWallet
      eligiblePrice {
        ...TokenPrice
        ...UsdPrice
        usd
        token {
          unit
          symbol
          contractAddress
          chain {
            identifier
            __typename
          }
          __typename
        }
        __typename
      }
      ... on Erc1155SeaDropV2Stage {
        fromTokenId
        toTokenId
        maxTotalMintableByWalletPerToken
        eligibleMaxTotalMintableByWalletPerToken
        __typename
      }
      __typename
    }
  }
}
fragment TokenPrice on Price {
  usd
  token {
    unit
    symbol
    contractAddress
    chain {
      identifier
      __typename
    }
    __typename
  }
  __typename
}
fragment UsdPrice on Price {
  usd
  token {
    contractAddress
    unit
    ...currencyIdentifier
    __typename
  }
  __typename
}
fragment currencyIdentifier on ContractIdentifier {
  contractAddress
  chain {
    identifier
    __typename
  }
  __typename
}`;

    const gqlRes = await send("https://gql.opensea.io/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
        referer: "https://opensea.io/"
      },
      body: JSON.stringify({
        operationName: "DropEligibilityQuery",
        query,
        variables: { address, collectionSlug: slug }
      })
    });
    if (!gqlRes.ok) throw new Error(`OpenSea eligibility query failed with ${gqlRes.status}.`);
    const json = (await gqlRes.json().catch(() => null)) as
      | { data?: { dropBySlug?: { stages?: Array<Record<string, unknown>> } }; errors?: unknown }
      | null;
    if (!json) throw new Error("OpenSea eligibility response was not JSON.");
    if (json.errors) throw new Error("OpenSea eligibility response included GraphQL errors.");
    const drop = json.data?.dropBySlug;
    if (!drop) throw new Error("OpenSea did not return drop data for this collection.");

    const stages = Array.isArray(drop.stages) ? drop.stages : [];
    return {
      address,
      stages: stages
        .filter((stage) => Boolean(stage.isEligible) && stage.stageType !== "PUBLIC_SALE")
        .map((stage) => {
          const stageType = typeof stage.stageType === "string" ? stage.stageType : "STAGE";
          const rawIndex = Number(stage.stageIndex);
          const stageIndex = Number.isFinite(rawIndex) ? rawIndex : null;
          const maxMint = Number(stage.eligibleMaxTotalMintableByWallet ?? 0);
          return {
            stage: stageIndex === null ? stageType : `${stageType}#${stageIndex}`,
            stageType,
            stageIndex,
            maxMint: Number.isFinite(maxMint) ? maxMint : 0
          };
        })
    };
  }

  async getMintPayload(
    slug: string,
    walletAddress: string,
    quantity: number,
    phaseType?: MintPhaseType,
    stageIndex?: number,
  ): Promise<MintPayload> {
    // Build the base body, optionally including a specific stage_index.
    const buildBody = (idx?: number) =>
      JSON.stringify({
        wallet_address: walletAddress,
        minter: walletAddress,   // OpenSea requires both wallet_address and minter
        quantity,
        ...(phaseType ? { phase_type: phaseType } : {}),
        ...(idx != null ? { stage_index: idx } : {}),
      });

    // First attempt: use whatever stageIndex was passed in (may be undefined).
    let lastError: unknown;
    try {
      const data = await this.request<Record<string, unknown>>(`/drops/${slug}/mint`, {
        method: "POST",
        body: buildBody(stageIndex),
      });
      const payload = mintPayloadFrom(data);
      if (payload) return payload;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry stage indices on a 400 that looks like a missing-field error.
      // 404 = phase not open / wallet not eligible → don't probe indices.
      const is400 = msg.includes(" 400");
      if (!is400 || stageIndex != null) throw err;
      lastError = err;
    }

    // Second attempt: OpenSea returned 400 and no explicit stageIndex was
    // provided. Probe stage_index 0–3 — multi-stage drops (GTD + public) require
    // this field and it is not stored in the DB yet.
    for (let idx = 0; idx <= 3; idx++) {
      try {
        const data = await this.request<Record<string, unknown>>(`/drops/${slug}/mint`, {
          method: "POST",
          body: buildBody(idx),
        });
        const payload = mintPayloadFrom(data);
        if (payload) return payload;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Stop probing on non-400 errors (rate limit, 5xx, etc.)
        if (!msg.includes(" 400")) throw err;
        lastError = err;
      }
    }

    throw lastError ?? new Error("OpenSea mint response did not include transaction data.");
  }

  private async request<T>(path: string, init?: RequestInit, timeoutMs = 8_000): Promise<T> {
    const cacheKey = init?.method && init.method !== "GET" ? undefined : path;
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-api-key": this.options.apiKey,
            ...init?.headers
          }
        });
        clearTimeout(timer);
        if (response.ok) {
          const data = (await response.json()) as T;
          if (cacheKey) this.cache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: data });
          return data;
        }
        if (response.status === 429) throw new Error("OpenSea rate limit reached. Try again shortly.");
        throw new Error(`OpenSea request failed with ${response.status}: ${await errorDetails(response)}`);
      } catch (error) {
        clearTimeout(timer);
        // Don't retry on abort (timeout) — the endpoint is clearly too slow.
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`OpenSea request timed out after ${timeoutMs}ms: ${path}`);
        }
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private normalizeChain(chain: string): SupportedNetwork {
    return chain.toLowerCase().includes("ethereum") ? "ethereum" : "base";
  }

  // Extract a flat list of 0x addresses from various allowlist response shapes.
  private extractAddressList(data: Record<string, unknown>): string[] {
    const candidates = [
      data.addresses, data.wallets, data.allowlist, data.entries,
      data.minters, data.eligible_addresses, data.eligible_wallets,
      (isRecord(data.allowlist) ? (data.allowlist as Record<string, unknown>).addresses : undefined),
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) {
        const addrs = c.map((item) =>
          typeof item === "string" ? item :
          isRecord(item) ? String(item.address ?? item.wallet ?? item.wallet_address ?? "") : ""
        ).filter((a) => a.startsWith("0x"));
        if (addrs.length > 0) return addrs;
      }
    }
    return [];
  }

  private normalizePhase(phase: string, name = ""): MintPhaseType {
    // Check both the API stage_type AND the human-readable name.
    // OpenSea often returns stage_type="allowlist" for GTD/FCFS phases,
    // but the name field reveals the real intent.
    const combined = `${phase} ${name}`.toLowerCase();
    if (combined.includes("gtd") || combined.includes("guaranteed")) return "gtd";
    if (combined.includes("fcfs") || combined.includes("first come first") || combined.includes("firstcome")) return "fcfs";
    if (combined.includes("allow") || combined.includes("presale") || combined.includes("signed") || combined.includes("support")) return "allowlist";
    return "public";
  }
}

async function errorDetails(response: Response) {
  try {
    const body = await response.text();
    return body ? body.slice(0, 800) : response.statusText;
  } catch {
    return response.statusText;
  }
}

function dateStringFrom(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value !== "string" && typeof value !== "number") continue;

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return undefined;
}

function mintPayloadFrom(data: Record<string, unknown>): MintPayload | undefined {
  const candidates = [
    data,
    objectAt(data, ["transaction"]),
    objectAt(data, ["tx"]),
    objectAt(data, ["transaction_data"]),
    objectAt(data, ["transactionData"]),
    objectAt(data, ["payload"]),
    objectAt(data, ["mint"]),
    objectAt(data, ["data"]),
    objectAt(data, ["fulfillment_data", "transaction"]),
    objectAt(data, ["fulfillmentData", "transaction"])
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const to = stringFrom(candidate, [["to"], ["target"], ["contract"], ["address"]]);
    const dataHex = stringFrom(candidate, [["data"], ["calldata"], ["callData"], ["input"]]);
    if (!to || !dataHex) continue;
    return {
      to: to as `0x${string}`,
      data: dataHex as `0x${string}`,
      value: BigInt(stringFrom(candidate, [["value"], ["valueWei"], ["value_wei"], ["amount"]]) ?? "0")
    };
  }

  return undefined;
}

function mintParamsFrom(data: Record<string, unknown>): OpenSeaMintParams | undefined {
  const candidates = [
    data,
    objectAt(data, ["mint_params"]),
    objectAt(data, ["mintParams"]),
    objectAt(data, ["mint", "mint_params"]),
    objectAt(data, ["mint", "mintParams"]),
    objectAt(data, ["allowlist", "mint_params"]),
    objectAt(data, ["allowlist", "mintParams"]),
    objectAt(data, ["eligibility"]),
    objectAt(data, ["eligibility", "mint_params"]),
    objectAt(data, ["eligibility", "mintParams"]),
    objectAt(data, ["result"]),
    objectAt(data, ["result", "mint_params"]),
    objectAt(data, ["result", "mintParams"]),
    objectAt(data, ["signed_mint", "mint_params"]),
    objectAt(data, ["signedMint", "mintParams"]),
    objectAt(data, ["phase"]),
    objectAt(data, ["stage"])
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const mintPriceWei = stringFrom(candidate, [
      ["mintPrice"],
      ["mint_price"],
      ["mintPriceWei"],
      ["mint_price_wei"],
      ["priceWei"],
      ["price_wei"],
      ["price"]
    ]);
    const maxTotalMintableByWallet = stringFrom(candidate, [
      ["maxTotalMintableByWallet"],
      ["max_total_mintable_by_wallet"],
      ["maxMintPerWallet"],
      ["max_mint_per_wallet"]
    ]);
    const startTime = stringFrom(candidate, [["startTime"], ["start_time"], ["startsAt"], ["starts_at"]]);
    const endTime = stringFrom(candidate, [["endTime"], ["end_time"], ["endsAt"], ["ends_at"]]);
    const dropStageIndex = stringFrom(candidate, [
      ["dropStageIndex"],
      ["drop_stage_index"],
      ["stageIndex"],
      ["stage_index"],
      ["index"]
    ]);
    const maxTokenSupplyForStage = stringFrom(candidate, [
      ["maxTokenSupplyForStage"],
      ["max_token_supply_for_stage"],
      ["maxStageSupply"],
      ["max_stage_supply"]
    ]);
    const feeBps = stringFrom(candidate, [["feeBps"], ["fee_bps"]]);
    const restrictFeeRecipients =
      booleanFrom(candidate, [["restrictFeeRecipients"], ["restrict_fee_recipients"]]) ?? true;

    if (
      mintPriceWei == null ||
      maxTotalMintableByWallet == null ||
      startTime == null ||
      endTime == null ||
      dropStageIndex == null ||
      maxTokenSupplyForStage == null ||
      feeBps == null
    ) {
      continue;
    }

    return {
      mintPriceWei: normalizeWeiString(mintPriceWei),
      maxTotalMintableByWallet,
      startTime: normalizeTimestampString(startTime),
      endTime: normalizeTimestampString(endTime),
      dropStageIndex,
      maxTokenSupplyForStage,
      feeBps,
      restrictFeeRecipients
    };
  }

  return undefined;
}

function objectAt(data: Record<string, unknown>, path: string[]) {
  let current: unknown = data;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return isRecord(current) ? current : undefined;
}

function stringFrom(data: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = data;
    for (const key of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (typeof current === "string" || typeof current === "number" || typeof current === "bigint") {
      return String(current);
    }
  }

  return undefined;
}

function hexStringFrom(data: Record<string, unknown>, paths: string[][]): `0x${string}` | undefined {
  const value = stringFrom(data, paths);
  return value?.startsWith("0x") ? (value as `0x${string}`) : undefined;
}

function booleanFrom(data: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = data;
    for (const key of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (typeof current === "boolean") return current;
    if (typeof current === "string") {
      if (current.toLowerCase() === "true") return true;
      if (current.toLowerCase() === "false") return false;
    }
  }

  return undefined;
}

function stringArrayFrom(data: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = data;
    for (const key of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (Array.isArray(current)) return current.map(String).filter((item) => item.startsWith("0x"));
  }

  return undefined;
}

function normalizeWeiString(value: string) {
  if (!value.includes(".")) return value;
  const [whole, fractional = ""] = value.split(".");
  const paddedFractional = `${fractional}000000000000000000`.slice(0, 18);
  return `${BigInt(whole || "0") * 1_000_000_000_000_000_000n + BigInt(paddedFractional || "0")}`;
}

function ethStatFrom(data: Record<string, unknown>, paths: string[][]) {
  const value = stringFrom(data, paths);
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed.toString();
}

function normalizeTimestampString(value: string) {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000).toString();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
