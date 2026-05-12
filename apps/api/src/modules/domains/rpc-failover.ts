import { ConfigService } from "@nestjs/config";
import { type ChainName } from "@mint-copilot/blockchain";
import { RpcPool } from "@mint-copilot/rpc-pool";
import { keccak256, type Hex } from "viem";

export type NetworkName = "BASE" | "ETHEREUM";

export function chainNameForNetwork(network: string): ChainName {
  return network === "BASE" ? "base" : "ethereum";
}

export function rpcUrlsForNetwork(network: string, config: ConfigService): string[] {
  const prefix = network === "BASE" ? "BASE" : "ETH";
  return [
    config.getOrThrow<string>(`${prefix}_RPC_PRIMARY`),
    config.get<string>(`${prefix}_RPC_BACKUP_1`),
    config.get<string>(`${prefix}_RPC_BACKUP_2`),
  ].filter(Boolean) as string[];
}

export function primaryRpcForNetwork(network: string, config: ConfigService): string {
  return rpcUrlsForNetwork(network, config)[0];
}

export function rpcPoolForNetwork(network: string, config: ConfigService): RpcPool {
  const chainName = chainNameForNetwork(network);
  return new RpcPool(
    rpcUrlsForNetwork(network, config).map((url, index) => ({
      id: `${chainName}-${index}`,
      name: index === 0 ? "Primary" : `Backup ${index}`,
      url,
      chainName,
      priority: index + 1,
    })),
    { broadcastTimeoutMs: numberConfig(config, "MINT_BROADCAST_TIMEOUT_MS", 2_500) },
  );
}

export async function broadcastWithRpcPool(
  network: string,
  config: ConfigService,
  serializedTransaction: Hex,
): Promise<Hex> {
  const chainName = chainNameForNetwork(network);
  const broadcasts = await rpcPoolForNetwork(network, config).broadcastUntilAccepted(
    chainName,
    serializedTransaction,
  );
  const successful = broadcasts.find((result) => result.ok && result.hash);
  if (successful?.hash) return successful.hash;

  const alreadyKnown = broadcasts.some((result) =>
    /already known|known transaction|already imported/i.test(result.error ?? ""),
  );
  if (alreadyKnown) return keccak256(serializedTransaction);

  throw new Error(
    broadcasts
      .map((item) => item.error)
      .filter(Boolean)
      .join("; ") || "RPC broadcast did not return a transaction hash.",
  );
}

function numberConfig(config: ConfigService, name: string, fallback: number) {
  const parsed = Number(config.get<string>(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}
