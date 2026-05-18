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
    async scanDropByContract(contractAddress, chain) {
        let slug;
        try {
            const data = await this.request(`/chain/${chain}/contract/${contractAddress}`);
            slug = typeof data.collection === "string" ? data.collection : undefined;
        }
        catch {
            // If the direct contract lookup fails, fall through to slug-less error below
        }
        if (!slug) {
            throw new Error(`No collection found on OpenSea for contract ${contractAddress} on ${chain}. Make sure the contract is listed on OpenSea.`);
        }
        const info = await this.getCollectionInfo(slug);
        const phases = await this.getDropPhases(slug);
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
    async getCollectionStats(slug) {
        const [data, bestOfferEth] = await Promise.all([
            this.request(`/collections/${slug}/stats`),
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
    async fetchBestOfferEth(slug) {
        try {
            const data = await this.request(`/offers/collection/${slug}/best`);
            const price = isRecord(data.price) ? data.price : null;
            if (price) {
                const value = price.value ?? price.amount;
                const decimals = typeof price.decimals === "number" ? price.decimals : 18;
                if (typeof value === "string" || typeof value === "number") {
                    const eth = Number(value) / Math.pow(10, decimals);
                    return eth.toString();
                }
            }
            if (typeof data.current_price === "string") {
                return (Number(data.current_price) / 1e18).toString();
            }
        }
        catch { /* best-effort — non-fatal */ }
        return undefined;
    }
    async getDropPhases(slug) {
        try {
            const data = await this.request(`/drops/${slug}`);
            const stages = Array.isArray(data.stages) ? data.stages : Array.isArray(data.phases) ? data.phases : [];
            if (stages.length > 0) {
                return stages.flatMap((stage, index) => {
                    const item = stage;
                    const priceWei = String(item.price ?? "0");
                    const priceEth = (Number(BigInt(priceWei)) / 1e18).toString();
                    const maxPerWallet = item.max_per_wallet != null ? Number(item.max_per_wallet) : undefined;
                    const startTime = dateStringFrom(item, ["start_time", "startTime", "start_date", "startDate", "starts_at", "startsAt"]);
                    if (!startTime) return [];
                    return {
                        id: String(item.uuid ?? item.id ?? `${slug}-${index}`),
                        type: this.normalizePhase(String(item.stage_type ?? item.type ?? item.phase_type ?? "public"), String(item.name ?? item.title ?? item.stage_name ?? item.label ?? "")),
                        priceEth,
                        startTime,
                        endTime: dateStringFrom(item, ["end_time", "endTime", "end_date", "endDate", "ends_at", "endsAt"]),
                        maxMintPerWallet: maxPerWallet && maxPerWallet > 0 ? maxPerWallet : undefined,
                        mintParams: mintParamsFrom(item)
                    };
                });
            }
        }
        catch { /* fall through */ }
        try {
            const data = await this.request(`/drops/${slug}/phases`);
            const phases = Array.isArray(data.phases) ? data.phases : [];
            return phases.flatMap((phase, index) => {
                const item = phase;
                const startTime = dateStringFrom(item, ["start_time", "startTime", "start_date", "startDate", "starts_at", "startsAt"]);
                if (!startTime) return [];
                return {
                    id: String(item.id ?? `${slug}-${index}`),
                    type: this.normalizePhase(String(item.type ?? item.phase_type ?? "public")),
                    priceEth: String(item.price_eth ?? item.price ?? "0"),
                    startTime,
                    endTime: dateStringFrom(item, ["end_time", "endTime", "end_date", "endDate", "ends_at", "endsAt"]),
                    maxMintPerWallet: item.max_mint_per_wallet != null ? Number(item.max_mint_per_wallet) : undefined,
                    mintParams: mintParamsFrom(item)
                };
            });
        }
        catch {
            return [];
        }
    }
    async checkEligibility(slug, walletAddress, phaseType, options) {
        const chain = options?.chain?.toLowerCase() ?? "ethereum";
        const contract = options?.contractAddress;
        const getEndpoints = [
            `/drops/${slug}/eligibility?wallet_address=${walletAddress}&phase_type=${phaseType}`,
            `/drops/${slug}/eligibility?wallet_address=${walletAddress}`,
            `/drops/${slug}/eligibility?wallet=${walletAddress}&phase=${phaseType}`,
            `/drops/${slug}/eligibility/${walletAddress}?phase=${phaseType}`,
            `/drops/${slug}/allowlist?wallet_address=${walletAddress}`,
            `/drops/${slug}?wallet_address=${walletAddress}`,
            ...(contract ? [
                `/chain/${chain}/contract/${contract}/drops/eligibility?wallet_address=${walletAddress}&phase_type=${phaseType}`,
                `/chain/${chain}/contract/${contract}/drops/eligibility?wallet_address=${walletAddress}`,
                `/chain/${chain}/contract/${contract}/drops/allowlist?wallet_address=${walletAddress}`,
                `/chain/${chain}/contract/${contract}/seadrop/allowlist?wallet_address=${walletAddress}`,
            ] : []),
        ];
        let data = null;
        for (const endpoint of getEndpoints) {
            try {
                data = await this.request(endpoint);
                break;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!msg.includes("404")) throw err;
            }
        }
        if (!data) {
            try {
                const mintData = await this.request(`/drops/${slug}/mint`, {
                    method: "POST",
                    body: JSON.stringify({ wallet_address: walletAddress, quantity: 1 }),
                });
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
            }
            catch (mintErr) {
                const mintMsg = mintErr instanceof Error ? mintErr.message : String(mintErr);
                const mintMsgLower = mintMsg.toLowerCase();
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
                    return { eligible: false, phaseType, reason: mintMsg };
                }
            }
        }
        for (const endpoint of [
            `/drops/${slug}/allowlist`,
            `/drops/${slug}/allowlist?limit=1000`,
            ...(contract ? [
                `/chain/${chain}/contract/${contract}/drops/allowlist`,
                `/chain/${chain}/contract/${contract}/drops/allowlist?limit=1000`,
            ] : []),
        ]) {
            try {
                const listData = await this.request(endpoint);
                const addresses = this.extractAddressList(listData);
                if (addresses.length > 0) {
                    const lower = walletAddress.toLowerCase();
                    const eligible = addresses.some((a) => a.toLowerCase() === lower);
                    return {
                        eligible,
                        phaseType,
                        reason: eligible ? "Wallet found in OpenSea allowlist." : "Wallet not found in OpenSea allowlist.",
                    };
                }
            }
            catch { /* continue */ }
        }
        try {
            const dropData = await this.request(`/drops/${slug}`);
            const stages = Array.isArray(dropData.stages) ? dropData.stages : Array.isArray(dropData.phases) ? dropData.phases : [];
            for (const stage of stages) {
                const stageId = stage.uuid ?? stage.id ?? stage.stage_id;
                if (!stageId) continue;
                for (const ep of [
                    `/drops/${slug}/stages/${stageId}/eligibility?wallet_address=${walletAddress}`,
                    `/drops/${slug}/stages/${stageId}?wallet_address=${walletAddress}`,
                    `/drops/${slug}/phases/${stageId}/eligibility?wallet_address=${walletAddress}`,
                ]) {
                    try {
                        const stageData = await this.request(ep);
                        const eligible =
                            booleanFrom(stageData, [["eligible"], ["is_eligible"], ["isEligible"]]) ??
                            Boolean(mintPayloadFrom(stageData) ?? stringArrayFrom(stageData, [["proof"]]));
                        return { eligible, phaseType, reason: eligible ? "Wallet is eligible." : "Wallet is not eligible." };
                    }
                    catch (e) {
                        const m = e instanceof Error ? e.message : String(e);
                        if (!m.includes("404")) throw e;
                    }
                }
            }
        }
        catch { /* ignore */ }
        if (!data) {
            throw new Error("404: OpenSea eligibility could not be verified for this phase. Check manually on opensea.io.");
        }
        const payload = mintPayloadFrom(data);
        const proof = stringArrayFrom(data, [["proof"], ["merkle_proof"], ["merkleProof"], ["allowlist", "proof"], ["eligibility", "proof"], ["mint", "proof"]]);
        const signature = hexStringFrom(data, [["signature"], ["signed_mint", "signature"], ["signedMint", "signature"], ["mint", "signature"]]);
        const mintParams = mintParamsFrom(data);
        const eligible =
            booleanFrom(data, [["eligible"], ["is_eligible"], ["isEligible"], ["eligibility", "eligible"], ["result", "eligible"]]) ??
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
    async postSeaportListing(chain, parameters, signature) {
        await this.request(`/orders/${chain}/seaport/listings`, {
            method: "POST",
            body: JSON.stringify({ parameters, signature }),
        });
    }
    async getMintPayload(slug, walletAddress, quantity, phaseType) {
        const data = await this.request(`/drops/${slug}/mint`, {
            method: "POST",
            body: JSON.stringify({
                wallet_address: walletAddress,
                quantity,
                ...(phaseType ? { phase_type: phaseType } : {}),
            })
        });
        const payload = mintPayloadFrom(data);
        if (!payload) throw new Error("OpenSea mint response did not include transaction data.");
        return payload;
    }
    async request(path, init, timeoutMs = 8000) {
        const cacheKey = init?.method && init.method !== "GET" ? undefined : path;
        if (cacheKey) {
            const cached = this.cache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) return cached.value;
        }
        let lastError;
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
                    const data = await response.json();
                    if (cacheKey) this.cache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: data });
                    return data;
                }
                if (response.status === 429) throw new Error("OpenSea rate limit reached. Try again shortly.");
                throw new Error(`OpenSea request failed with ${response.status}: ${await errorDetails(response)}`);
            }
            catch (error) {
                clearTimeout(timer);
                if (error instanceof Error && error.name === "AbortError") {
                    throw new Error(`OpenSea request timed out after ${timeoutMs}ms: ${path}`);
                }
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
            }
        }
        throw lastError;
    }
    normalizeChain(chain) {
        return chain.toLowerCase().includes("ethereum") ? "ethereum" : "base";
    }
    extractAddressList(data) {
        const candidates = [
            data.addresses, data.wallets, data.allowlist, data.entries,
            data.minters, data.eligible_addresses, data.eligible_wallets,
            (isRecord(data.allowlist) ? data.allowlist.addresses : undefined),
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
    normalizePhase(phase, name = "") {
        const combined = `${phase} ${name}`.toLowerCase();
        if (combined.includes("gtd") || combined.includes("guaranteed")) return "gtd";
        if (combined.includes("fcfs") || combined.includes("first come first") || combined.includes("firstcome")) return "fcfs";
        if (combined.includes("allow") || combined.includes("presale") || combined.includes("signed") || combined.includes("support")) return "allowlist";
        return "public";
    }
}
async function errorDetails(response) {
    try {
        const body = await response.text();
        return body ? body.slice(0, 240) : response.statusText;
    }
    catch {
        return response.statusText;
    }
}
function dateStringFrom(item, keys) {
    for (const key of keys) {
        const value = item[key];
        if (typeof value !== "string" && typeof value !== "number") continue;
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return undefined;
}
function mintPayloadFrom(data) {
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
            to: to,
            data: dataHex,
            value: BigInt(stringFrom(candidate, [["value"], ["valueWei"], ["value_wei"], ["amount"]]) ?? "0")
        };
    }
    return undefined;
}
function mintParamsFrom(data) {
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
        const mintPriceWei = stringFrom(candidate, [["mintPrice"], ["mint_price"], ["mintPriceWei"], ["mint_price_wei"], ["priceWei"], ["price_wei"], ["price"]]);
        const maxTotalMintableByWallet = stringFrom(candidate, [["maxTotalMintableByWallet"], ["max_total_mintable_by_wallet"], ["maxMintPerWallet"], ["max_mint_per_wallet"]]);
        const startTime = stringFrom(candidate, [["startTime"], ["start_time"], ["startsAt"], ["starts_at"]]);
        const endTime = stringFrom(candidate, [["endTime"], ["end_time"], ["endsAt"], ["ends_at"]]);
        const dropStageIndex = stringFrom(candidate, [["dropStageIndex"], ["drop_stage_index"], ["stageIndex"], ["stage_index"], ["index"]]);
        const maxTokenSupplyForStage = stringFrom(candidate, [["maxTokenSupplyForStage"], ["max_token_supply_for_stage"], ["maxStageSupply"], ["max_stage_supply"]]);
        const feeBps = stringFrom(candidate, [["feeBps"], ["fee_bps"]]);
        const restrictFeeRecipients = booleanFrom(candidate, [["restrictFeeRecipients"], ["restrict_fee_recipients"]]) ?? true;
        if (mintPriceWei == null || maxTotalMintableByWallet == null || startTime == null || endTime == null || dropStageIndex == null || maxTokenSupplyForStage == null || feeBps == null) {
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
function objectAt(data, path) {
    let current = data;
    for (const key of path) {
        if (!isRecord(current)) return undefined;
        current = current[key];
    }
    return isRecord(current) ? current : undefined;
}
function stringFrom(data, paths) {
    for (const path of paths) {
        let current = data;
        for (const key of path) {
            if (!isRecord(current)) { current = undefined; break; }
            current = current[key];
        }
        if (typeof current === "string" || typeof current === "number" || typeof current === "bigint") {
            return String(current);
        }
    }
    return undefined;
}
function hexStringFrom(data, paths) {
    const value = stringFrom(data, paths);
    return value?.startsWith("0x") ? value : undefined;
}
function booleanFrom(data, paths) {
    for (const path of paths) {
        let current = data;
        for (const key of path) {
            if (!isRecord(current)) { current = undefined; break; }
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
function stringArrayFrom(data, paths) {
    for (const path of paths) {
        let current = data;
        for (const key of path) {
            if (!isRecord(current)) { current = undefined; break; }
            current = current[key];
        }
        if (Array.isArray(current)) return current.map(String).filter((item) => item.startsWith("0x"));
    }
    return undefined;
}
function normalizeWeiString(value) {
    if (!value.includes(".")) return value;
    const [whole, fractional = ""] = value.split(".");
    const paddedFractional = `${fractional}000000000000000000`.slice(0, 18);
    return `${BigInt(whole || "0") * 1_000_000_000_000_000_000n + BigInt(paddedFractional || "0")}`;
}
function ethStatFrom(data, paths) {
    const value = stringFrom(data, paths);
    if (value == null) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed.toString();
}
function normalizeTimestampString(value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000).toString();
    return value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=index.js.map
