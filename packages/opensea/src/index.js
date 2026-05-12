export function parseOpenSeaUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (!url.hostname.endsWith("opensea.io"))
        throw new Error("Only OpenSea URLs are supported.");
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
    options;
    baseUrl;
    fetchImpl;
    cache = new Map();
    constructor(options) {
        this.options = options;
        this.baseUrl = options.baseUrl ?? "https://api.opensea.io/api/v2";
        this.fetchImpl = options.fetchImpl ?? fetch;
    }
    async scanDrop(url) {
        const parsed = parseOpenSeaUrl(url);
        const info = await this.getCollectionInfo(parsed.slug);
        const phases = await this.getDropPhases(parsed.slug);
        return { ...info, phases };
    }
    async getCollectionInfo(slug) {
        const data = await this.request(`/collections/${slug}`);
        const contracts = data.contracts ?? [];
        const firstContract = contracts[0] ?? {};
        return {
            slug,
            name: String(data.name ?? slug),
            imageUrl: typeof data.image_url === "string" ? data.image_url : undefined,
            chain: this.normalizeChain(String(firstContract.chain ?? data.chain ?? "base")),
            contractAddress: String(firstContract.address ?? "0x0000000000000000000000000000000000000000"),
            supply: Number(data.total_supply ?? 0),
            phases: []
        };
    }
    async getDropPhases(slug) {
        const data = await this.request(`/drops/${slug}/phases`);
        const phases = Array.isArray(data.phases) ? data.phases : [];
        return phases.map((phase, index) => {
            const item = phase;
            return {
                id: String(item.id ?? `${slug}-${index}`),
                type: this.normalizePhase(String(item.type ?? item.phase_type ?? "public")),
                priceEth: String(item.price ?? item.price_eth ?? "0"),
                startTime: String(item.start_time ?? new Date().toISOString()),
                endTime: typeof item.end_time === "string" ? item.end_time : undefined,
                maxMintPerWallet: Number(item.max_mint_per_wallet ?? 1)
            };
        });
    }
    async checkEligibility(slug, walletAddress, phaseType) {
        const data = await this.request(`/drops/${slug}/eligibility?wallet=${walletAddress}&phase=${phaseType}`);
        return {
            eligible: Boolean(data.eligible),
            phaseType,
            reason: typeof data.reason === "string" ? data.reason : undefined,
            proof: Array.isArray(data.proof) ? data.proof.map(String) : undefined
        };
    }
    async getMintPayload(slug, walletAddress, quantity) {
        const data = await this.request(`/drops/${slug}/mint`, {
            method: "POST",
            body: JSON.stringify({ walletAddress, quantity })
        });
        return {
            to: String(data.to),
            data: String(data.data),
            value: BigInt(String(data.value ?? "0"))
        };
    }
    async request(path, init) {
        const cacheKey = init?.method && init.method !== "GET" ? undefined : path;
        if (cacheKey) {
            const cached = this.cache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now())
                return cached.value;
        }
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                    ...init,
                    headers: {
                        accept: "application/json",
                        "content-type": "application/json",
                        "x-api-key": this.options.apiKey,
                        ...init?.headers
                    }
                });
                if (response.ok) {
                    const data = (await response.json());
                    if (cacheKey)
                        this.cache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: data });
                    return data;
                }
                if (response.status === 429)
                    throw new Error("OpenSea rate limit reached. Try again shortly.");
                throw new Error(`OpenSea request failed with ${response.status}`);
            }
            catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
            }
        }
        throw lastError;
    }
    normalizeChain(chain) {
        return chain.toLowerCase().includes("ethereum") ? "ethereum" : "base";
    }
    normalizePhase(phase) {
        const normalized = phase.toLowerCase();
        if (normalized.includes("allow"))
            return "allowlist";
        if (normalized.includes("gtd"))
            return "gtd";
        if (normalized.includes("fcfs"))
            return "fcfs";
        return "public";
    }
}
//# sourceMappingURL=index.js.map