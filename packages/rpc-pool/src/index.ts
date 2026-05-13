import { createMintPublicClient, type ChainName, sendRawTransaction } from "@mint-copilot/blockchain";
import type { Hex } from "viem";

export interface RpcEndpointConfig {
  id: string;
  name: string;
  url: string;
  chainName: ChainName;
  priority: number;
}

export interface RpcHealth {
  endpointId: string;
  status: "healthy" | "degraded" | "offline";
  latencyMs: number | null;
  blockNumber?: bigint;
  checkedAt: Date;
}

export interface BroadcastResult {
  endpointId: string;
  provider: string;
  ok: boolean;
  hash?: Hex;
  error?: string;
}

export interface RpcPoolOptions {
  broadcastTimeoutMs?: number;
  // Multiplier applied to measured ping latency to derive per-endpoint broadcast
  // timeout (e.g. 10 → Quiknode 25ms ping gets 250ms timeout).
  // Result is clamped to [dynamicTimeoutMinMs, dynamicTimeoutMaxMs].
  // When set, this overrides broadcastTimeoutMs for healthy endpoints.
  dynamicTimeoutMultiplier?: number;
  dynamicTimeoutMinMs?: number;
  dynamicTimeoutMaxMs?: number;
}

export class RpcPool {
  private health = new Map<string, RpcHealth>();

  constructor(
    private readonly endpoints: RpcEndpointConfig[],
    private readonly options: RpcPoolOptions = {}
  ) {}

  endpointsFor(chainName: ChainName): RpcEndpointConfig[] {
    return this.endpoints
      .filter((endpoint) => endpoint.chainName === chainName)
      .sort((a, b) => a.priority - b.priority);
  }

  async checkEndpoint(endpoint: RpcEndpointConfig): Promise<RpcHealth> {
    const started = Date.now();
    try {
      const blockNumber = await createMintPublicClient({
        chainName: endpoint.chainName,
        rpcUrl: endpoint.url
      }).getBlockNumber();
      const latencyMs = Date.now() - started;
      const status = latencyMs > 1_500 ? "degraded" : "healthy";
      const result = { endpointId: endpoint.id, status, latencyMs, blockNumber, checkedAt: new Date() } as const;
      this.health.set(endpoint.id, result);
      return result;
    } catch {
      const result = {
        endpointId: endpoint.id,
        status: "offline",
        latencyMs: null,
        checkedAt: new Date()
      } as const;
      this.health.set(endpoint.id, result);
      return result;
    }
  }

  async checkAll(chainName?: ChainName): Promise<RpcHealth[]> {
    const endpoints = chainName ? this.endpointsFor(chainName) : this.endpoints;
    return Promise.all(endpoints.map((endpoint) => this.checkEndpoint(endpoint)));
  }

  selectPrimary(chainName: ChainName): RpcEndpointConfig {
    const endpoints = this.endpointsFor(chainName);
    // Select the healthy endpoint with the lowest latency (latency-first routing)
    const healthyEndpoints = endpoints.filter(
      (endpoint) => this.health.get(endpoint.id)?.status === "healthy"
    );
    healthyEndpoints.sort((a, b) => {
      const la = this.health.get(a.id)?.latencyMs ?? Infinity;
      const lb = this.health.get(b.id)?.latencyMs ?? Infinity;
      return la - lb;
    });
    return healthyEndpoints[0] ?? endpoints[0];
  }

  async parallelBroadcast(chainName: ChainName, serializedTransaction: Hex): Promise<BroadcastResult[]> {
    const endpoints = this.endpointsFor(chainName);
    return Promise.all(endpoints.map((endpoint) => this.broadcastToEndpoint(endpoint, serializedTransaction)));
  }

  async broadcastUntilAccepted(chainName: ChainName, serializedTransaction: Hex): Promise<BroadcastResult[]> {
    const endpoints = this.endpointsFor(chainName);
    if (endpoints.length === 0) return [];

    return new Promise((resolve) => {
      const results: BroadcastResult[] = [];
      let pending = endpoints.length;
      let resolved = false;

      const settle = (result: BroadcastResult) => {
        results.push(result);
        pending -= 1;

        if (!resolved && result.ok && result.hash) {
          resolved = true;
          resolve(results);
          return;
        }

        if (!resolved && pending === 0) {
          resolved = true;
          resolve(results);
        }
      };

      for (const endpoint of endpoints) {
        void this.broadcastToEndpoint(endpoint, serializedTra