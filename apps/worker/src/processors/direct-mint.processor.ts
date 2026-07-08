/**
 * Direct Contract Mint Processor
 * Executes arbitrary write-function calls on NFT contracts (non-SeaDrop).
 * Picks up jobs from the "direct-mint-queue" BullMQ queue.
 */
import type { Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import {
  createMintPublicClient,
  sendRawTransaction,
  signTransaction,
  waitForReceipt,
} from "@mint-copilot/blockchain";
import {
  fetchCurrentGas,
  resolveGasFees,
  type GasSettings,
} from "@mint-copilot/gas-engine";
import { logger } from "@mint-copilot/logger";
import { encodeFunctionData, type Abi, type AbiFunction } from "viem";

// ── Job payload ───────────────────────────────────────────────────────────────
export interface DirectMintJobPayload {
  taskId: string;
}

// ── Main processor ────────────────────────────────────────────────────────────
export async function processDirectMintJob(
  job: Job<DirectMintJobPayload>,
  prisma: PrismaClient,
): Promise<void> {
  const { taskId } = job.data;
  const taskLog = (level: string, message: string) => appendLog(prisma, taskId, level, message);

  await taskLog("info", `Direct mint job started (task ${taskId}).`);

  // ── Load task ──────────────────────────────────────────────────────────────
  const task = await prisma.directMintTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      wallets: {
        include: {
          wallet: {
            select: {
              id: true,
              address: true,
              network: true,
              encryptedPrivateKey: true,
              encryptionSalt: true,
              encryptionIv: true,
              encryptionAuthTag: true,
              encryptionVersion: true,
            },
          },
        },
      },
    },
  });

  const network = task.chain === "BASE" ? "base" : task.chain === "ROBINHOOD" ? "robinhood" : "ethereum";
  const chainName = network as "base" | "ethereum" | "robinhood";
  const rpcUrls = rpcUrlsFor(chainName);
  const primaryRpc = await fastestRpcUrl(chainName, rpcUrls);

  if (!primaryRpc) {
    await markFailed(prisma, taskId, "No RPC URL configured for " + network);
    return;
  }

  // ── Fetch live gas ─────────────────────────────────────────────────────────
  await taskLog("info", "Fetching live gas prices.");
  let gasQuote;
  try {
    gasQuote = await fetchCurrentGas({ chainName, rpcUrl: primaryRpc });
  } catch (error) {
    await markFailed(prisma, taskId, `Gas fetch failed: ${rawError(error)}`);
    return;
  }

  const gasSettings = task.gasSettingsJson as unknown as GasSettings;
  const gasFees = resolveGasFees(gasQuote, gasSettings);

  // ── Build call data ────────────────────────────────────────────────────────
  const contractAddress = task.contractAddress as `0x${string}`;
  const functionAbi = task.functionAbi as unknown as AbiFunction;
  const callArgs = task.callArgs as unknown[];
  const valueWei = BigInt(task.valueWei ?? "0");

  let callData: `0x${string}`;
  try {
    callData = encodeFunctionData({
      abi: [functionAbi] as Abi,
      functionName: task.functionName,
      args: coerceArgs(functionAbi, callArgs),
    });
  } catch (error) {
    await markFailed(prisma, taskId, `Failed to encode call data: ${rawError(error)}`);
    return;
  }

  // ── Execute per wallet ─────────────────────────────────────────────────────
  let anySuccess = false;

  for (const taskWallet of task.wallets) {
    const wallet = taskWallet.wallet;
    const shortAddr = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;

    if (taskWallet.status === "done") {
      await taskLog("info", `Wallet ${shortAddr} already completed — skipping.`);
      continue;
    }

    await prisma.directMintTaskWallet.update({
      where: { id: taskWallet.id },
      data: { status: "running" },
    });

    try {
      const publicClient = createMintPublicClient({ chainName, rpcUrl: primaryRpc });

      // Get current nonce
      const nonce = await publicClient.getTransactionCount({
        address: wallet.address as `0x${string}`,
        blockTag: "pending",
      });

      // Estimate gas limit (with 20% headroom)
      let gasLimit: bigint;
      try {
        const estimated = await publicClient.estimateGas({
          account: wallet.address as `0x${string}`,
          to: contractAddress,
          data: callData,
          value: valueWei,
        });
        gasLimit = (estimated * 120n) / 100n;
      } catch {
        // Fallback gas limit if estimation fails (e.g. function reverts in simulation)
        gasLimit = 300_000n;
        await taskLog("warn", `${shortAddr}: gas estimation failed — using fallback 300k.`);
      }

      // Decrypt private key
      const privateKey = await decryptPrivateKey(
        {
          encryptedPrivateKey: wallet.encryptedPrivateKey,
          encryptionSalt: wallet.encryptionSalt,
          encryptionIv: wallet.encryptionIv,
          encryptionAuthTag: wallet.encryptionAuthTag,
          encryptionVersion: wallet.encryptionVersion,
        },
        { masterKey: env("ENCRYPTION_MASTER_KEY") },
      );

      // Sign
      const signedTx = await signTransaction(
        { chainName, rpcUrl: primaryRpc },
        privateKey,
        {
          to: contractAddress,
          data: callData,
          value: valueWei,
          gas: gasLimit,
          nonce,
          maxFeePerGas: gasFees.maxFeePerGas,
          maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
        },
      );

      await taskLog("info", `${shortAddr}: tx signed — broadcasting.`);

      // Broadcast to the fastest RPC first, then fall back to the remaining RPCs.
      let txHash: `0x${string}` | undefined;
      const broadcastUrls = [primaryRpc, ...rpcUrls.filter((url) => url !== primaryRpc)];
      for (const rpcUrl of broadcastUrls) {
        try {
          txHash = await sendRawTransaction({ chainName, rpcUrl, timeoutMs: 3_000 }, signedTx);
          break;
        } catch {
          // Try next RPC
        }
      }

      if (!txHash) throw new Error("All RPCs failed to broadcast the transaction.");

      const broadcastBlockNumber = await publicClient.getBlockNumber().catch(() => null);
      await taskLog(
        "info",
        `${shortAddr}: broadcast OK — hash ${txHash}${broadcastBlockNumber == null ? "" : ` from block ${broadcastBlockNumber.toString()}`}.`,
      );

      await prisma.directMintTaskWallet.update({
        where: { id: taskWallet.id },
        data: { status: "broadcast", txHash },
      });

      // Wait for receipt
      try {
        const receipt = await waitForReceipt({ chainName, rpcUrl: primaryRpc }, txHash, {
          confirmations: 1,
          timeoutMs: 120_000,
        });
        const firstBlockHit =
          broadcastBlockNumber == null
            ? null
            : receipt.blockNumber <= broadcastBlockNumber + 1n;
        await taskLog(
          "info",
          `${shortAddr}: mint confirmed in block ${receipt.blockNumber.toString()} — gas ${formatGwei(receipt.effectiveGasPrice)} gwei, used ${receipt.gasUsed.toLocaleString()}${firstBlockHit === null ? "" : firstBlockHit ? " — FIRST BLOCK HIT" : " — missed first block"}.`,
        );
      } catch {
        await taskLog("warn", `${shortAddr}: receipt timeout — tx may still confirm later.`);
      }

      await prisma.directMintTaskWallet.update({
        where: { id: taskWallet.id },
        data: { status: "done" },
      });

      anySuccess = true;
    } catch (error) {
      const msg = rawError(error);
      await taskLog("error", `${shortAddr}: FAILED — ${msg}`);
      await prisma.directMintTaskWallet.update({
        where: { id: taskWallet.id },
        data: { status: "failed", errorMessage: msg },
      });
    }
  }

  // ── Finalise task ──────────────────────────────────────────────────────────
  const allWallets = await prisma.directMintTaskWallet.findMany({
    where: { directMintTaskId: taskId },
    select: { status: true },
  });

  const allDone = allWallets.every((w) => w.status === "done");
  const allFailed = allWallets.every((w) => w.status === "failed");

  const finalStatus = allDone ? "COMPLETED" : allFailed ? "FAILED" : anySuccess ? "COMPLETED" : "FAILED";

  await prisma.directMintTask.update({
    where: { id: taskId },
    data: { status: finalStatus, completedAt: new Date() },
  });

  await taskLog("info", `Task finished with status ${finalStatus}.`);
  logger.info({ taskId, status: finalStatus }, "Direct mint task completed.");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function appendLog(prisma: PrismaClient, taskId: string, level: string, message: string) {
  try {
    await prisma.directMintLog.create({ data: { directMintTaskId: taskId, level, message } });
    logger.info({ taskId, level }, message);
  } catch {
    // Non-fatal
  }
}

async function markFailed(prisma: PrismaClient, taskId: string, reason: string) {
  await prisma.directMintTask.update({
    where: { id: taskId },
    data: { status: "FAILED", completedAt: new Date() },
  });
  await appendLog(prisma, taskId, "error", reason);
  logger.error({ taskId }, reason);
}

/**
 * Coerce string-encoded args to their proper viem types based on the ABI.
 * Numbers/booleans coming from JSON are strings; viem needs proper types.
 */
function coerceArgs(fn: AbiFunction, args: unknown[]): unknown[] {
  const inputs = fn.inputs ?? [];
  return args.map((arg, i) => {
    const type = inputs[i]?.type ?? "";
    if (!arg && arg !== 0 && arg !== false) return arg;
    if (type.startsWith("uint") || type.startsWith("int")) {
      try { return BigInt(String(arg)); } catch { return arg; }
    }
    if (type === "bool") {
      if (typeof arg === "string") return arg === "true" || arg === "1";
      return Boolean(arg);
    }
    return arg;
  });
}

function rpcUrlsFor(network: "base" | "ethereum" | "robinhood"): string[] {
  const prefix = network === "base" ? "BASE" : network === "robinhood" ? "ROBINHOOD" : "ETH";
  return [
    process.env[`${prefix}_RPC_PRIMARY`],
    process.env[`${prefix}_RPC_BACKUP_1`],
    process.env[`${prefix}_RPC_BACKUP_2`],
  ].filter(Boolean) as string[];
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function rawError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fastestRpcUrl(chainName: "base" | "ethereum" | "robinhood", urls: string[]) {
  if (urls.length <= 1) return urls[0];
  const checks = await Promise.all(
    urls.map(async (url) => {
      const started = Date.now();
      try {
        await Promise.race([
          createMintPublicClient({ chainName, rpcUrl: url }).getBlockNumber(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 450)),
        ]);
        return { url, latencyMs: Date.now() - started };
      } catch {
        return { url, latencyMs: Infinity };
      }
    }),
  );
  checks.sort((a, b) => a.latencyMs - b.latencyMs);
  return checks[0]?.latencyMs === Infinity ? urls[0] : checks[0]?.url ?? urls[0];
}

function formatGwei(wei: bigint): string {
  const whole = wei / 1_000_000_000n;
  const fraction = ((wei % 1_000_000_000n) / 10_000_000n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}`;
}
