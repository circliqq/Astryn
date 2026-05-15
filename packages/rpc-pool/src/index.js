import { createMintPublicClient, sendRawTransaction } from "../../blockchain/src/index.ts";
export class RpcPool {
    endpoints;
    health = new Map();
    constructor(endpoints) {
        this.endpoints = endpoints;
    }
    endpointsFor(chainName) {
        return this.endpoints
            .filter((endpoint) => endpoint.chainName === chainName)
            .sort((a, b) => a.priority - b.priority);
    }
    async checkEndpoint(endpoint, timeoutMs = 1_500) {
        const started = Date.now();
        const offline = { endpointId: endpoint.id, status: "offline", latencyMs: null, checkedAt: new Date() };
        try {
            const blockNumber = await Promise.race([
                createMintPublicClient({ chainName: endpoint.chainName, rpcUrl: endpoint.url }).getBlockNumber(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs ?? 1_500)),
            ]);
            const latencyMs = Date.now() - started;
            const status = latencyMs > 1_500 ? "degraded" : "healthy";
            const result = { endpointId: endpoint.id, status, latencyMs, blockNumber, checkedAt: new Date() };
            this.health.set(endpoint.id, result);
            return result;
        }
        catch {
            this.health.set(endpoint.id, offline);
            return offline;
        }
    }
    async checkAll(chainName) {
        const endpoints = chainName ? this.endpointsFor(chainName) : this.endpoints;
        return Promise.all(endpoints.map((endpoint) => this.checkEndpoint(endpoint)));
    }
    async checkPrimary(chainName) {
        const primary = this.endpointsFor(chainName)[0];
        if (!primary) return [];
        return [await this.checkEndpoint(primary)];
    }
    selectPrimary(chainName) {
        const endpoints = this.endpointsFor(chainName);
        const healthy = endpoints.find((endpoint) => this.health.get(endpoint.id)?.status === "healthy");
        return healthy ?? endpoints[0];
    }
    async parallelBroadcast(chainName, serializedTransaction) {
        const endpoints = this.endpointsFor(chainName);
        return Promise.all(endpoints.map(async (endpoint) => {
            try {
                const hash = await sendRawTransaction({ chainName: endpoint.chainName, rpcUrl: endpoint.url }, serializedTransaction);
                return { endpointId: endpoint.id, provider: endpoint.name, ok: true, hash };
            }
            catch (error) {
                return {
                    endpointId: endpoint.id,
                    provider: endpoint.name,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }));
    }
}
//# sourceMappingURL=index.js.map