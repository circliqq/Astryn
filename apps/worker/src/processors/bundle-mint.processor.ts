/**
 * Bundle Mint Processor
 * ---------------------------------------------------------------------------
 * Atomic, same-block NFT minting.
 *
 *  • MULTI_WALLET            — many wallets mint together in ONE bundle.
 *  • SINGLE_WALLET_MULTI_TX  — one wallet fires N txs into the same block.
 *
 * Ethereum : submitted as a Flashbots bundle (eth_sendBundle) targeting a
 *            specific block for atomic, all-or-nothing inclusion.
 * Base     : OP-Stack sequencer has no eth_sendBundle, so signed txs are
 *            broadcast in parallel to several fast Base endpoints — they land
 *            in the same (or adjacent) block because the sequencer is single.
 *
 * Picks up jobs from the "bundle-mint-queue" BullMQ queue.
 */
import type { Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import {
  buildOrchestrateCallCalldata,
  buildOrchestrateSeaDropCalldata,
  createMintPublicClient,
  createSeaDropPublicMintPayload,
  sendSponsored7702Transaction,
  signMintAuthorization,
  signTransaction,
  waitForReceipt,
} from "@mint-copilot/blockchain";
import { fetchCurrentGas, resolveGasFees, type GasSettings } from "@mint-copilot/gas-engine";
import { logger } from "@mint-copilot/logger";
import {
  encodeFunctionData,
  keccak256,
  toHex,
  type Abi,
  type AbiFunction,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Job payload ─────────────────────────────────────────────────────────────
export interface BundleMintJobPayload {
  taskId: string;
}

interface SignedEntry {
  walletId: string;
  shortAddr: string;
  raw: Hex;
  hash: Hex;
}

// ── Main processor ──────────────────────────────────────────────────────────
export async function processBundleMintJob(
  job: Job<BundleMintJobPayload>,
  prisma: PrismaClient,
): Promise<void> {
  const { taskId } = job.data;
  const taskLog = (level: string, message: string) => appendLog(prisma, taskId, level, message);

  await taskLog("info", `Bundle mint job started (task ${taskId}).`);

  const task = await prisma.bundleMintTask.findUniqueOrThrow({
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

  const chainName = (task.chain === "BASE" ? "base" : "ethereum") as "base" | "ethereum";
  const rpcUrls = rpcUrlsFor(chainName);
  const primaryRpc = await fastestRpcUrl(chainName, rpcUrls);

  if (!primaryRpc) {
    await markFailed(prisma, taskId, `No RPC URL configured for ${chainName}.`);
    return;
  }

  // ── Live gas ────────────────────────────────────────────────────────────
  await taskLog("info", "Fetching live gas prices.");
  let gasQuote;
  try {
    gasQuote = await fetchCurrentGas({ chainName, rpcUrl: primaryRpc });
  } catch (error) {
    await markFailed(prisma, taskId, `Gas fetch failed: ${rawError(error)}`);
    return;
  }
  const gasSettings = task.gasSettingsJson as unknown as GasSettings;
  const gasFees = resolveGasFees(gasQuote, gasSettings, chainName);
  await taskLog(
    "info",
    `Gas resolved — maxFee ${formatGwei(gasFees.maxFeePerGas)} gwei, priority ${formatGwei(gasFees.maxPriorityFeePerGas)} gwei.`,
  );

  // ── Build the mint call (to / data / value) ───────────────────────────────
  const contractAddress = task.contractAddress as `0x${string}`;
  const quantity = Math.max(1, task.mintQuantity);

  function buildCall(minter: `0x${string}`): { to: `0x${string}`; data: Hex; value: bigint } {
    if (task.kind === "SEADROP") {
      const payload = createSeaDropPublicMintPayload({
        nftContract: contractAddress,
        minter,
        mintPriceWei: BigInt(task.mintPriceWei ?? "0"),
        quantity,
      });
      return { to: payload.to as `0x${string}`, data: payload.data as Hex, value: payload.value };
    }
    // CUSTOM
    const functionAbi = task.functionAbi as unknown as AbiFunction;
    const data = encodeFunctionData({
      abi: [functionAbi] as Abi,
      functionName: task.functionName ?? "",
      args: coerceArgs(functionAbi, (task.callArgs as unknown[]) ?? []),
    });
    return { to: contractAddress, data, value: BigInt(task.valueWei ?? "0") };
  }

  const publicClient = createMintPublicClient({ chainName, rpcUrl: primaryRpc });

  // Decrypt + sign helper
  async function signFor(
    wallet: (typeof task.wallets)[number]["wallet"],
    nonce: number,
  ): Promise<Hex> {
    const call = buildCall(wallet.address as `0x${string}`);

    let gasLimit: bigint;
    try {
      const estimated = await publicClient.estimateGas({
        account: wallet.address as `0x${string}`,
        to: call.to,
        data: call.data,
        value: call.value,
      });
      gasLimit = (estimated * 130n) / 100n;
    } catch {
      gasLimit = task.kind === "SEADROP" ? 350_000n : 300_000n;
    }

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

    return signTransaction({ chainName, rpcUrl: primaryRpc }, privateKey as Hex, {
      to: call.to,
      data: call.data,
      value: call.value,
      gas: gasLimit,
      nonce,
      maxFeePerGas: gasFees.maxFeePerGas,
      maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
    });
  }

  // ── EIP-7702 atomic bundle (sub-wallets delegate, sponsor sends one tx) ────
  if (task.mode === "EIP7702") {
    await runEip7702Bundle({
      prisma,
      task,
      chainName,
      rpcUrl: primaryRpc,
      contractAddress,
      quantity,
      buildCall,
      gasFees,
      taskLog,
    });
    return;
  }

  // ── Build the signed-tx set per mode ──────────────────────────────────────
  const signed: SignedEntry[] = [];

  try {
    if (task.mode === "SINGLE_WALLET_MULTI_TX") {
      const tw = task.wallets[0];
      if (!tw) throw new Error("No wallet selected.");
      const wallet = tw.wallet;
      const short = shorten(wallet.address);
      const startNonce = await publicClient.getTransactionCount({
        address: wallet.address as `0x${string}`,
        blockTag: "pending",
      });
      const count = Math.max(1, task.txPerWallet);
      for (let i = 0; i < count; i++) {
        const raw = await signFor(wallet, startNonce + i);
        signed.push({ walletId: tw.id, shortAddr: short, raw, hash: keccak256(raw) });
      }
      await taskLog("info", `Signed ${count} tx(s) from ${short} (nonces ${startNonce}–${startNonce + count - 1}).`);
    } else {
      // MULTI_WALLET — one tx per wallet, all in one bundle
      for (const tw of task.wallets) {
        const wallet = tw.wallet;
        const short = shorten(wallet.address);
        try {
          const nonce = await publicClient.getTransactionCount({
            address: wallet.address as `0x${string}`,
            blockTag: "pending",
          });
          const raw = await signFor(wallet, nonce);
          signed.push({ walletId: tw.id, shortAddr: short, raw, hash: keccak256(raw) });
        } catch (error) {
          const msg = rawError(error);
          await taskLog("error", `${short}: sign failed — ${msg}`);
          await prisma.bundleMintTaskWallet.update({
            where: { id: tw.id },
            data: { status: "failed", errorMessage: msg },
          });
        }
      }
      await taskLog("info", `Signed ${signed.length} wallet tx(s) for the bundle.`);
    }
  } catch (error) {
    await markFailed(prisma, taskId, `Signing failed: ${rawError(error)}`);
    return;
  }

  if (signed.length === 0) {
    await markFailed(prisma, taskId, "No transactions could be signed.");
    return;
  }

  // ── Target block ──────────────────────────────────────────────────────────
  const currentBlock = await publicClient.getBlockNumber();
  const baseTarget = task.targetBlock
    ? BigInt(task.targetBlock)
    : currentBlock + BigInt(Math.max(1, task.blockOffset));

  // ── Submit ────────────────────────────────────────────────────────────────
  const rawTxs = signed.map((s) => s.raw);
  let bundleHash: string | null = null;

  try {
    if (chainName === "ethereum") {
      bundleHash = await submitFlashbotsBundle({
        authKey: env("ETH_FLASHBOTS_AUTH_KEY") as Hex,
        signedTxs: rawTxs,
        firstBlock: baseTarget,
        retries: Math.max(0, task.maxBlockRetries),
        relayUrl: process.env.ETH_FLASHBOTS_RELAY_URL ?? "https://relay.flashbots.net",
        log: taskLog,
      });
    } else {
      bundleHash = await broadcastBaseParallel(rawTxs, taskLog);
    }
  } catch (error) {
    await markFailed(prisma, taskId, `Bundle submission failed: ${rawError(error)}`);
    return;
  }

  await prisma.bundleMintTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", bundleHash, targetBlock: baseTarget.toString() },
  });

  // Mark broadcast + remember per-wallet tx hash
  for (const entry of signed) {
    await prisma.bundleMintTaskWallet.update({
      where: { id: entry.walletId },
      data: { status: "broadcast", txHash: entry.hash },
    });
  }
  await taskLog(
    "info",
    `Bundle submitted (target block ${baseTarget.toString()}${bundleHash ? `, hash ${bundleHash}` : ""}). Waiting for inclusion…`,
  );

  // ── Poll inclusion (per-tx receipts) ──────────────────────────────────────
  let includedBlock: bigint | null = null;
  let anySuccess = false;

  for (const entry of signed) {
    try {
      const receipt = await waitForReceipt({ chainName, rpcUrl: primaryRpc }, entry.hash, {
        confirmations: 1,
        timeoutMs: 90_000,
      });
      includedBlock = receipt.blockNumber;
      anySuccess = true;
      await prisma.bundleMintTaskWallet.update({
        where: { id: entry.walletId },
        data: { status: "done", txHash: entry.hash },
      });
      await taskLog(
        "info",
        `${entry.shortAddr}: included in block ${receipt.blockNumber.toString()} — gas used ${receipt.gasUsed.toLocaleString()}.`,
      );
    } catch {
      await prisma.bundleMintTaskWallet.update({
        where: { id: entry.walletId },
        data: { status: "failed", errorMessage: "Not included before timeout." },
      });
      await taskLog("warn", `${entry.shortAddr}: not included before timeout (tx ${entry.hash}).`);
    }
  }

  const wallets = await prisma.bundleMintTaskWallet.findMany({
    where: { bundleMintTaskId: taskId },
    select: { status: true },
  });
  const allDone = wallets.every((w) => w.status === "done");
  const finalStatus = allDone || anySuccess ? "COMPLETED" : "FAILED";

  await prisma.bundleMintTask.update({
    where: { id: taskId },
    data: {
      status: finalStatus,
      includedBlock: includedBlock ? includedBlock.toString() : null,
      completedAt: new Date(),
    },
  });

  await taskLog(
    "info",
    `Bundle mint finished with status ${finalStatus}${includedBlock ? ` (block ${includedBlock.toString()})` : ""}.`,
  );
  logger.info({ taskId, status: finalStatus }, "Bundle mint task completed.");
}

// ── EIP-7702 atomic bundle ───────────────────────────────────────────────────
interface Eip7702Args {
  prisma: PrismaClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: any;
  chainName: "base" | "ethereum";
  rpcUrl: string;
  contractAddress: `0x${string}`;
  quantity: number;
  buildCall: (minter: `0x${string}`) => { to: `0x${string}`; data: Hex; value: bigint };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gasFees: any;
  taskLog: (level: string, message: string) => Promise<void>;
}

async function runEip7702Bundle(a: Eip7702Args) {
  const { prisma, task, chainName, rpcUrl, contractAddress, quantity, buildCall, gasFees, taskLog } = a;
  const taskId = task.id as string;
  const options = { chainName, rpcUrl } as const;

  if (!task.sponsorWalletId) {
    await markFailed(prisma, taskId, "EIP-7702 mode requires a sponsor (main) wallet.");
    return;
  }
  const sponsor = await prisma.wallet.findUnique({
    where: { id: task.sponsorWalletId as string },
    select: {
      address: true,
      encryptedPrivateKey: true,
      encryptionSalt: true,
      encryptionIv: true,
      encryptionAuthTag: true,
      encryptionVersion: true,
    },
  });
  if (!sponsor) {
    await markFailed(prisma, taskId, "Sponsor wallet not found.");
    return;
  }

  const executor = (task.executorAddress ??
    process.env[
      chainName === "base" ? "BUNDLE_MINT_7702_EXECUTOR_BASE" : "BUNDLE_MINT_7702_EXECUTOR_ETH"
    ]) as `0x${string}` | undefined;
  if (!executor) {
    await markFailed(
      prisma,
      taskId,
      "No BundleMint7702 executor configured (set executorAddress or BUNDLE_MINT_7702_EXECUTOR_*).",
    );
    return;
  }

  const subWallets = task.wallets as Array<{
    id: string;
    wallet: {
      address: string;
      encryptedPrivateKey: string;
      encryptionSalt: string;
      encryptionIv: string;
      encryptionAuthTag: string;
      encryptionVersion: string;
    };
  }>;
  if (subWallets.length === 0) {
    await markFailed(prisma, taskId, "No sub-wallets selected.");
    return;
  }

  const masterKey = env("ENCRYPTION_MASTER_KEY");

  // 1) Each sub-wallet signs a 7702 authorization → delegate to executor.
  const minters: `0x${string}`[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authorizationList: any[] = [];
  for (const tw of subWallets) {
    const w = tw.wallet;
    const short = shorten(w.address);
    try {
      const pk = await decryptPrivateKey(
        {
          encryptedPrivateKey: w.encryptedPrivateKey,
          encryptionSalt: w.encryptionSalt,
          encryptionIv: w.encryptionIv,
          encryptionAuthTag: w.encryptionAuthTag,
          encryptionVersion: w.encryptionVersion,
        },
        { masterKey },
      );
      const auth = await signMintAuthorization(options, pk as Hex, executor);
      authorizationList.push(auth);
      minters.push(w.address as `0x${string}`);
    } catch (error) {
      const msg = rawError(error);
      await taskLog("error", `${short}: 7702 authorization failed — ${msg}`);
      await prisma.bundleMintTaskWallet.update({
        where: { id: tw.id },
        data: { status: "failed", errorMessage: msg },
      });
    }
  }
  if (minters.length === 0) {
    await markFailed(prisma, taskId, "No sub-wallet authorizations could be signed.");
    return;
  }
  await taskLog("info", `Signed ${minters.length} EIP-7702 authorization(s) → executor ${executor}.`);

  // 2) Build orchestrator calldata + total value.
  //    Value Payer: TX_SENDER → sponsor forwards mint ETH; DELEGATED → sub-wallets self-fund.
  const payFromSender = (task.valuePayer ?? "TX_SENDER") === "TX_SENDER";
  let data: Hex;
  let totalValue: bigint;
  if (task.kind === "SEADROP") {
    const built = buildOrchestrateSeaDropCalldata({
      minters,
      nftContract: contractAddress,
      quantity,
      pricePerMintWei: BigInt(task.mintPriceWei ?? "0"),
      payFromSender,
    });
    data = built.data;
    totalValue = built.totalValue;
  } else {
    const call = buildCall(minters[0]); // mint calldata is minter-independent
    const built = buildOrchestrateCallCalldata({
      minters,
      target: contractAddress,
      perMinterValueWei: call.value,
      data: call.data,
      payFromSender,
    });
    data = built.data;
    totalValue = built.totalValue;
  }

  // 3) Gas limit heuristic — a plain estimate reverts before delegation applies.
  const gasLimit = 150_000n + 320_000n * BigInt(minters.length);

  // 3b) Optional precise start timestamp (ms epoch) — wait until then.
  if (task.startTimestampMs) {
    const targetMs = Number(task.startTimestampMs);
    const delay = targetMs - Date.now();
    if (Number.isFinite(delay) && delay > 0) {
      await taskLog("info", `Waiting ${Math.round(delay)}ms until start timestamp…`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 4) Sponsor sends the single atomic type-4 transaction.
  let txHash: Hex;
  try {
    const sponsorPk = await decryptPrivateKey(
      {
        encryptedPrivateKey: sponsor.encryptedPrivateKey,
        encryptionSalt: sponsor.encryptionSalt,
        encryptionIv: sponsor.encryptionIv,
        encryptionAuthTag: sponsor.encryptionAuthTag,
        encryptionVersion: sponsor.encryptionVersion,
      },
      { masterKey },
    );
    await taskLog(
      "info",
      `Sponsor ${shorten(sponsor.address)} sending atomic 7702 tx — ${minters.length} minters, value ${totalValue.toString()} wei.`,
    );
    txHash = await sendSponsored7702Transaction(options, sponsorPk as Hex, {
      to: executor,
      data,
      value: totalValue,
      gas: gasLimit,
      maxFeePerGas: gasFees.maxFeePerGas,
      maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
      authorizationList,
    });
  } catch (error) {
    await markFailed(prisma, taskId, `7702 tx send failed: ${rawError(error)}`);
    return;
  }

  await prisma.bundleMintTask.update({
    where: { id: taskId },
    data: { status: "RUNNING", bundleHash: txHash },
  });
  for (const tw of subWallets) {
    await prisma.bundleMintTaskWallet
      .update({ where: { id: tw.id }, data: { status: "broadcast", txHash } })
      .catch(() => undefined);
  }
  await taskLog("info", `7702 tx broadcast — ${txHash}. Waiting for receipt…`);

  // 5) Wait for the receipt and finalise.
  try {
    const receipt = await waitForReceipt(options, txHash, { confirmations: 1, timeoutMs: 120_000 });
    const ok = receipt.status === "success";
    await prisma.bundleMintTask.update({
      where: { id: taskId },
      data: {
        status: ok ? "COMPLETED" : "FAILED",
        includedBlock: receipt.blockNumber.toString(),
        completedAt: new Date(),
      },
    });
    for (const tw of subWallets) {
      await prisma.bundleMintTaskWallet
        .update({ where: { id: tw.id }, data: { status: ok ? "done" : "failed", txHash } })
        .catch(() => undefined);
    }
    await taskLog(
      ok ? "info" : "error",
      `7702 bundle ${ok ? "CONFIRMED" : "REVERTED"} in block ${receipt.blockNumber.toString()} — gas used ${receipt.gasUsed.toLocaleString()}.`,
    );
    logger.info({ taskId, status: ok ? "COMPLETED" : "FAILED" }, "Bundle mint (7702) completed.");
  } catch {
    await prisma.bundleMintTask.update({
      where: { id: taskId },
      data: { status: "FAILED", completedAt: new Date() },
    });
    await taskLog("warn", "7702 tx receipt timeout — it may still confirm; check the tx hash.");
  }
}

// ── Flashbots (Ethereum) ────────────────────────────────────────────────────
async function submitFlashbotsBundle(opts: {
  authKey: Hex;
  signedTxs: Hex[];
  firstBlock: bigint;
  retries: number;
  relayUrl: string;
  log: (level: string, message: string) => Promise<void>;
}): Promise<string | null> {
  const account = privateKeyToAccount(opts.authKey);
  let lastHash: string | null = null;

  for (let i = 0; i <= opts.retries; i++) {
    const targetBlock = opts.firstBlock + BigInt(i);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendBundle",
      params: [{ txs: opts.signedTxs, blockNumber: toHex(targetBlock) }],
    });

    // Flashbots requires the body hash signed by the auth key.
    const sig = await account.signMessage({ message: { raw: keccak256(toHex(body)) } });
    const authHeader = `${account.address}:${sig}`;

    try {
      const res = await fetch(opts.relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Flashbots-Signature": authHeader },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`relay ${res.status}: ${text}`);
      }
      const data = (await res.json()) as {
        result?: { bundleHash?: string };
        error?: { message?: string };
      };
      if (data.error) throw new Error(data.error.message ?? "relay error");
      lastHash = data.result?.bundleHash ?? lastHash;
      await opts.log("info", `Flashbots bundle sent for block ${targetBlock.toString()}.`);
    } catch (error) {
      await opts.log("warn", `Flashbots send for block ${targetBlock.toString()} failed: ${rawError(error)}`);
    }
  }

  return lastHash;
}

// ── Base parallel broadcast ─────────────────────────────────────────────────
const BASE_FAST_ENDPOINTS = [
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "https://rpc.flashbots.net/fast",
];

async function broadcastBaseParallel(
  signedTxs: Hex[],
  log: (level: string, message: string) => Promise<void>,
): Promise<string | null> {
  const results = await Promise.allSettled(
    signedTxs.flatMap((tx) =>
      BASE_FAST_ENDPOINTS.map(async (url) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendRawTransaction",
            params: [tx],
          }),
          signal: AbortSignal.timeout(3_000),
        });
        const data = (await res.json()) as { result?: string; error?: { message?: string } };
        if (data.error && !/already known|known transaction|nonce too low/i.test(data.error.message ?? "")) {
          throw new Error(data.error.message ?? "RPC error");
        }
        return data.result ?? null;
      }),
    ),
  );

  const firstHash = results.find((r) => r.status === "fulfilled" && r.value);
  if (results.every((r) => r.status === "rejected")) {
    throw new Error("All Base RPC endpoints rejected the transactions.");
  }
  await log("info", `Broadcast ${signedTxs.length} tx(s) to ${BASE_FAST_ENDPOINTS.length} Base endpoints.`);
  return firstHash?.status === "fulfilled" ? firstHash.value : null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function appendLog(prisma: PrismaClient, taskId: string, level: string, message: string) {
  try {
    await prisma.bundleMintLog.create({ data: { bundleMintTaskId: taskId, level, message } });
    logger.info({ taskId, level }, message);
  } catch {
    // Non-fatal
  }
}

async function markFailed(prisma: PrismaClient, taskId: string, reason: string) {
  await prisma.bundleMintTask.update({
    where: { id: taskId },
    data: { status: "FAILED", completedAt: new Date() },
  });
  await appendLog(prisma, taskId, "error", reason);
  logger.error({ taskId }, reason);
}

function coerceArgs(fn: AbiFunction, args: unknown[]): unknown[] {
  const inputs = fn.inputs ?? [];
  return args.map((arg, i) => {
    const type = inputs[i]?.type ?? "";
    if (!arg && arg !== 0 && arg !== false) return arg;
    if (type.startsWith("uint") || type.startsWith("int")) {
      try {
        return BigInt(String(arg));
      } catch {
        return arg;
      }
    }
    if (type === "bool") {
      if (typeof arg === "string") return arg === "true" || arg === "1";
      return Boolean(arg);
    }
    return arg;
  });
}

function rpcUrlsFor(network: "base" | "ethereum"): string[] {
  const prefix = network === "base" ? "BASE" : "ETH";
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

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fastestRpcUrl(chainName: "base" | "ethereum", urls: string[]) {
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
