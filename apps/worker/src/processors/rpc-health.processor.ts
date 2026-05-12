import type { Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { RpcPool } from "@mint-copilot/rpc-pool";

export async function processRpcHealth(_job: Job, prisma: PrismaClient) {
  const endpoints = await prisma.rpcEndpoint.findMany({ where: { enabled: true } });
  const pool = new RpcPool(
    endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      chainName: endpoint.network === "BASE" ? "base" : "ethereum",
      priority: endpoint.priority
    }))
  );
  const results = await pool.checkAll();
  await prisma.rpcHealthLog.createMany({
    data: results.map((result) => ({
      rpcEndpointId: result.endpointId,
      status: result.status.toUpperCase() as "HEALTHY",
      latencyMs: result.latencyMs,
      blockNumber: result.blockNumber?.toString()
    }))
  });
  return results;
}
