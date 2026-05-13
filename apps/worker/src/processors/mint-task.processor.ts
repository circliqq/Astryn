import { Queue, type Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import {
  createSeaDropAllowListMintPayload,
  createSeaDropPublicMintPayload,
  createSeaDropSignedMintPayload,
  createMintPublicClient,
  signTransaction,
  simulateTx,
  waitForReceipt,
} from "@mint-copilot/blockchain";
import {
  applyGasGuardian,
  buildBumpedFees,
  estimateTransactionGasCost,
  fetchCurrentGas,
  presetGasSettings,
  resolveGasFees,
  type GasSettings,
  type ResolvedGasFees,
} from "@mint-copilot/gas-engine";
import { OpenSeaClient } from "@mint-copilot/opensea";
import { RpcPool } from "@mint-copilot/rpc-pool";
import {
  calculateReadinessScore,
  toUserFacingError,
} from "@mint-copilot/shared";
import { logger } from "@mint-copilot/logger";
import { createPublicClient, webSocket, keccak256, toBytes, type Hex } from "viem";
import { mainnet, base as viemBase } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { EligibilityResult, MintPayload, SeaportOrderParameters } from "@mint-copilot/opensea";

// ── Seaport constants ─────────────────────────────────────────────────────────
const SEAPORT_V15_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395" as `0x${string}`;
const OPENSEA_CONDUIT_KEY = "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000" as `0x${string}`;
const OPENSEA_FEE_RECIPIENT = "0x0000a26b00c1F0DF003000390027140000fAa719" as `0x${string}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
const SEAPORT_CHAIN_IDS: Record<string, number> = { ethereum: 1, base: 8453 };
const OPENSEA_FEE_BPS = 250n; // 2.5%
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Minimal ABI for reading supply from ERC721 contracts.
// Covers totalSupply / maxSupply / _maxSupply naming conventions.
const ERC721_SUPPLY_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxSupply",   stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "_maxSupply",  stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const SEAPORT_GET_COUNTER_ABI = [
  {
    name: "getCounter",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "offerer", type: "address" }],
    outputs: [{ name: "counter", type: "uint256" }],
  },
] as const;

const SEAPORT_EIP712_TYPES = {
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" },
  ],
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

interface MintTaskJob {
  taskId: string;
  runAt?: string;
}

interface PreparedMint {
  taskWalletId: string;
  walletId: string;
  walletAddress: `0x${string}`;
  quantity: number;
  priorityMint: boolean;
  priorityRank: number | null;
  signedTx: Hex;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  simulationFailed: boolean;
  mintPayloadForRetry: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
  };
  walletCrypto: {
    encryptedPrivateKey: string;
    encryptionSalt: string;
    encryptionIv: string;
    encryptionAuthTag: string;
    encryptionVersion: string;
  };
  // Stage max supply from OpenSea mintParams — avoids contract RPC call in supply watcher.
  stageMaxSupply?: bigint;
}

interface BroadcastedMint extends PreparedMint {
  transactionId: string;
  hash: Hex;
  // All tx hashes broadcast for this wallet (original + bumped) — tracked for multi-hash receipt.
  allHashes: Hex[];
}

interface PriorityMintingSettings {
  enabled?: boolean;
  maxTransactions?: number;
  supplyBuffer?: number;
  priorityWalletIds?: string[];
}

interface InstantFlipperSettings {
  enabled?: boolean;
  mode?: "auto" | "manual";
  priceMode?: "floor_percent" | "fixed";
  floorMultiplier?: number;
  fixedPriceEth?: number;
  minPriceEth?: number;
  maxPerWallet?: number;
}

type ReceiptOutcome =
  | { status: "confirmed"; tokenIds: bigint[] }
  | { status: "pending" }
  | { status: "failed" };

export async function executeMintTask(
  job: Job<MintTaskJob>,
  prisma: PrismaClient,
) {
  const task = await prisma.mintTask.findUniqueOrThrow({
    where: { id: job.data.taskId },
    include: {
      collection: { include: { phases: { orderBy: { startTime: "asc" } } } },
      wallets: { include: { wallet: true } },
    },
  });
  const targetAt = resolveTargetAt(job.data.runAt, task.scheduledAt);
  const preArmMs = targetAt.getTime() - Date.now();

  await log(
    prisma,
    task.id,
    "info",
    preArmMs > 1_000
      ? `Pre-arming mint task. Target broadcast at ${targetAt.toISOString()}.`
      : "Starting immediate mint task execution.",
  );
  await prisma.mintTask.update({
    where: { id: task.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const openSea = new OpenSeaClient({ apiKey: env("OPENSEA_API_KEY") });
    const network = task.collection.chain === "BASE" ? "base" : "ethereum";
    const rpcUrls = rpcUrlsFor(network);
    const pool = new RpcPool(
      rpcUrls.map((url, index) => ({
        id: `${network}-${index}`,
        name: index === 0 ? "Primary" : `Backup ${index}`,
        url,
        chainName: network,
        priority: index + 1,
      })),
      {
        // Dynamic per-endpoint timeout: ping × multiplier, clamped to [min, max].
        // e.g. Quiknode 25ms ping → 250ms timeout, Chainstack 76ms → 760ms timeout.
        // Falls back to MINT_BROADCAST_TIMEOUT_MS only if no ping data yet.
        dynamicTimeoutMultiplier: numberEnv("MINT_BROADCAST_TIMEOUT_MULTIPLIER", 10),
        dynamicTimeoutMinMs: numberEnv("MINT_BROADCAST_TIMEOUT_MIN_MS", 300),
        dynamicTimeoutMaxMs: numberEnv("MINT_BROADCAST_TIMEOUT_MAX_MS", 1_200),
        broadcastTimeoutMs: numberEnv("MINT_BROADCAST_TIMEOUT_MS", 800),
      },
    );
    const receiptConfirmations = Math.max(
      1,
      Math.floor(numberEnv("MINT_RECEIPT_CONFIRMATIONS", 1)),
    );
    const receiptTimeoutMs = Math.max(
      1_000,
      Math.floor(numberEnv("MINT_RECEIPT_TIMEOUT_MS", 120_000)),
    );

    await log(prisma, task.id, "info", `Checking ${network} RPC health.`);
    await pool.checkAll(network);
    const primary = pool.selectPrimary(network);
    const client = createMintPublicClient({
      chainName: network,
      rpcUrl: primary.url,
    });
    await log(
      prisma,
      task.id,
      "info",
      `Selected ${primary.name} RPC for preflight, signing, and receipts.`,
    );
    const currentGas = await fetchCurrentGas({
      chainName: network,
      rpcUrl: primary.url,
    });
    await log(prisma, task.id, "info", "Loaded current network gas fees.", {
      baseFeePerGas: currentGas.baseFeePerGas.toString(),
      maxPriorityFeePerGas: currentGas.maxPriorityFeePerGas.toString(),
      maxFeePerGas: currentGas.maxFeePerGas.toString(),
    });

    // ── Bot Warfare: detect competing bots via gas spike ──────────────────
    const competition = await detectBotCompetition(
      prisma,
      task.id,
      task.collection.slug,
      task.collection.chain,
      currentGas,
    );
    if (competition.detected) {
      await log(
        prisma,
        task.id,
        "warn",
        `Bot competition detected — ~${competition.competitorCount} competitor(s) estimated. Boosting max fee to ${competition.recommendedMaxFeeGwei} Gwei.`,
        {
          competitorCount: competition.competitorCount,
          recommendedMaxFeeGwei: competition.recommendedMaxFeeGwei,
          spikeFactor: competition.spikeFactor,
        },
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Floor/Offer Ratio Gas Strategy ───────────────────────────────────
    // If top collection offer ≥ MINT_OFFER_RATIO_THRESHOLD × floor price,
    // demand is high — override gas mode to "aggressive" regardless of task settings.
    // Default threshold: 1.5× (offer ≥ 150% of floor = clearly profitable flip).
    const offerRatioThreshold = numberEnv("MINT_OFFER_RATIO_THRESHOLD", 1.5);
    let offerRatioGasOverride: { maxFeeGwei: number } | null = null;
    try {
      const marketStats = await openSea.getCollectionStats(task.collection.slug);
      const floor = marketStats.floorPriceEth ? Number(marketStats.floorPriceEth) : null;
      const bestOffer = marketStats.bestOfferEth ? Number(marketStats.bestOfferEth) : null;
      if (floor && floor > 0 && bestOffer && bestOffer > 0) {
        const ratio = bestOffer / floor;
        if (ratio >= offerRatioThreshold) {
          // Boost gas proportionally: at 1.5× ratio we add 20%, at 2× we add 40%, capped at 2×.
          const gasMultiplier = Math.min(2, 1 + (ratio - 1) * 0.4);
          const baseMaxFeeGwei = Number(currentGas.maxFeePerGas / 1_000_000_000n);
          offerRatioGasOverride = { maxFeeGwei: Math.ceil(baseMaxFeeGwei * gasMultiplier) };
          await log(prisma, task.id, "warn",
            `High demand detected: offer/floor ratio ${ratio.toFixed(2)}× (floor ${floor.toFixed(4)} ETH, best offer ${bestOffer.toFixed(4)} ETH). Boosting gas by ${Math.round((gasMultiplier - 1) * 100)}%.`,
            { ratio, floor, bestOffer, offerRatioGasOverride, gasMultiplier },
          );
        } else {
          await log(prisma, task.id, "info",
            `Offer/floor ratio ${ratio.toFixed(2)}× — below threshold (${offerRatioThreshold}×). Gas unchanged.`,
            { ratio, floor, bestOffer },
          );
        }
      }
    } catch (err) {
      // non-fatal — best-effort market signal
      await log(prisma, task.id, "warn",
        "Could not fetch collection market stats for offer/floor ratio check.",
        { rawError: rawErrorMessage(err) },
      ).catch(() => undefined);
    }
    // ─────────────────────────────────────────────────────────────────────

    const preparedResults = await mapWithConcurrency(
      task.wallets,
      numberEnv("MINT_PREP_CONCURRENCY", 4),
      async (taskWallet) => {
        try {
          const wallet = taskWallet.wallet;
          const mintQuantity = normalizeMintQuantity(
            taskWallet.mintQuantity ?? task.mintQuantity ?? 1,
          );
          const walletSettings = applyOfferRatioOverride(
            applyCompetitionBoost(
              resolveGasSettings(task.gasSettingsJson, taskWallet.gasSettingsJson),
              competition,
            ),
            offerRatioGasOverride,
          );
          const gasFees = resolveGasFees(currentGas, walletSettings, network);
          if (!gasFees.baseFeeCovered) {
            throw new Error(
              "Configured max fee per gas is less than the current block base fee.",
            );
          }

          await log(
            prisma,
            task.id,
            "info",
            `Preparing wallet ${shortAddress(wallet.address)} before phase open.`,
          );

          const eligibility = await resolveEligibility(
            openSea,
            task.collection.slug,
            wallet.address,
            task.phaseType,
            async (message, contextJson) =>
              log(prisma, task.id, "warn", message, contextJson),
          );
          const payload = await loadMintPayload(
            openSea,
            task.collection,
            task.phaseType,
            wallet.address,
            targetAt,
            mintQuantity,
            eligibility,
            async (message, contextJson) =>
              log(prisma, task.id, "warn", message, contextJson),
          );
          const [balanceWei, nonce] = await Promise.all([
            client.getBalance({ address: wallet.address as `0x${string}` }),
            client.getTransactionCount({
              address: wallet.address as `0x${string}`,
              blockTag: "pending",
            }),
          ]);

          await prisma.wallet
            .update({
              where: { id: wallet.id },
              data: { lastBalanceWei: balanceWei.toString(), lastNonce: nonce },
            })
            .catch(() => undefined);

          // ── Wallet Pre-flight Check ────────────────────────────────────
          // Also fetch confirmed nonce to detect stuck pending transactions.
          const confirmedNonce = await client.getTransactionCount({
            address: wallet.address as `0x${string}`,
            blockTag: "latest",
          }).catch(() => null);

          await runWalletPreFlight(
            prisma,
            task.id,
            wallet.id,
            wallet.address,
            balanceWei,
            nonce,
            confirmedNonce,
            payload.value,
            gasFees,
          );
          // ─────────────────────────────────────────────────────────────

          const mintPayloadForRetry = {
            to: payload.to,
            data: payload.data,
            value: payload.value,
          };
          const { gasLimit, simulationFailed } = await resolveGasLimit(
            {
              chainName: network,
              rpcUrl: primary.url,
            },
            {
              account: wallet.address as `0x${string}`,
              ...mintPayloadForRetry,
            },
            targetAt,
            async (message, contextJson) =>
              log(prisma, task.id, "warn", message, contextJson),
          );
          const gasEstimate = estimateTransactionGasCost(
            gasLimit,
            gasFees,
            walletSettings,
          );
          applyGasGuardian(gasEstimate, walletSettings);

          const readiness = calculateReadinessScore({
            walletFunded: balanceWei > payload.value + gasEstimate.totalCostWei,
            eligible: eligibility.eligible,
            simulationPassed: !simulationFailed,
            gasUnderCap: gasEstimate.underCap,
            rpcHealthy: true,
            nonceClean: true,
            contractLowRisk: true,
          });
          await prisma.readinessScore.create({
            data: {
              mintTaskId: task.id,
              walletId: wallet.id,
              score: readiness.score,
              level: readiness.level,
              breakdownJson: readiness.breakdown,
              blockersJson: readiness.blockers,
              warningsJson: readiness.warnings,
            },
          });
          if (readiness.blockers.length > 0) {
            throw new Error(readiness.blockers.join(" "));
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
          const signedTx = await signTransaction(
            { chainName: network, rpcUrl: primary.url },
            privateKey,
            {
              to: payload.to,
              data: payload.data,
              value: payload.value,
              gas: gasLimit,
              nonce,
              maxFeePerGas: gasFees.maxFeePerGas,
              maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
            },
          );

          await prisma.mintTaskWallet.update({
            where: { id: taskWallet.id },
            data: { status: "ready", progress: 75 },
          });
          await log(
            prisma,
            task.id,
            "info",
            `Wallet ${shortAddress(wallet.address)} tx signed and ready.`,
            { nonce, gasLimit: gasLimit.toString() },
          );

          return {
            taskWalletId: taskWallet.id,
            walletId: wallet.id,
            walletAddress: wallet.address as `0x${string}`,
            quantity: mintQuantity,
            priorityMint: taskWallet.priorityMint,
            priorityRank: taskWallet.priorityRank,
            signedTx,
            nonce,
            gasLimit,
            maxFeePerGas: gasFees.maxFeePerGas,
            maxPriorityFeePerGas: gasFees.maxPriorityFeePerGas,
            simulationFailed,
            mintPayloadForRetry,
            walletCrypto: {
              encryptedPrivateKey: wallet.encryptedPrivateKey,
              encryptionSalt: wallet.encryptionSalt,
              encryptionIv: wallet.encryptionIv,
              encryptionAuthTag: wallet.encryptionAuthTag,
              encryptionVersion: wallet.encryptionVersion,
            },
            // Use OpenSea phase supply instead of contract RPC call in supply watcher.
            stageMaxSupply: eligibility.mintParams?.maxTokenSupplyForStage
              ? BigInt(eligibility.mintParams.maxTokenSupplyForStage)
              : undefined,
          } satisfies PreparedMint;
        } catch (error) {
          await failWallet(prisma, task.id, taskWallet.id, taskWallet.wallet.id, error, "preflight");
          return null;
        }
      },
    );

    const prepared = preparedResults.filter(
      (item): item is PreparedMint => item !== null,
    );

    if (prepared.length === 0) {
      await finishTask(prisma, task.id, "FAILED", "Mint task failed before broadcast.");
      return;
    }

    const priorityMinting = resolvePriorityMinting(task.priorityMintingJson);
    const runnablePrepared = await applyPriorityMinting(
      prisma,
      task.id,
      prepared,
      priorityMinting,
    );

    if (runnablePrepared.length === 0) {
      await finishTask(prisma, task.id, "FAILED", "Priority minting skipped every prepared transaction.");
      return;
    }

    // ── Rolling simulation + timed wait ──────────────────────────────────
    // Wallets that used fallback gas (simulationFailed=true) are polled
    // every MINT_SIM_POLL_INTERVAL_MS during the sleep window. If simulation
    // passes before open we flip simulationFailed=false at no cost to timing.
    // At T=0 any still-failed wallets get one last-chance attempt
    // (MINT_SIM_LAST_CHANCE_TIMEOUT_MS). If still failing they are skipped —
    // no broadcast, no gas wasted.  Wallets that already passed simulation
    // skip all of this and broadcast immediately at T=0 with zero delay.
    const simulationVerified = await waitWithRollingSimulation(
      prisma,
      task.id,
      runnablePrepared,
      targetAt,
      { chainName: network, rpcUrl: primary.url },
    );

    if (simulationVerified.length === 0) {
      await finishTask(prisma, task.id, "FAILED", "Mint task failed: simulation rejected all prepared transactions before broadcast.");
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    // Fire-and-forget: do not await DB/log writes at T=0 — every ms counts.
    void log(
      prisma,
      task.id,
      "info",
      `Broadcasting ${simulationVerified.length} signed tx at phase open.`,
      { targetAt: targetAt.toISOString(), actualAt: new Date().toISOString() },
    ).catch(() => undefined);
    const broadcastStartedAt = Date.now();
    const broadcastResults = await Promise.all(
      simulationVerified.map(async (preparedMint) => {
        try {
          void prisma.mintTaskWallet.update({
            where: { id: preparedMint.taskWalletId },
            data: { status: "broadcasting", progress: 90 },
          }).catch(() => undefined);

          // All broadcast targets run in parallel at T=0.
          // Ethereum: RPC pool + Flashbots bundle (if key set) + free builders (if enabled).
          // Base: RPC pool only (no Flashbots/builders on Base).
          const flashbotsAuthKey = process.env["ETH_FLASHBOTS_AUTH_KEY"] as Hex | undefined;
          const buildersEnabled = /^(1|true|yes)$/i.test(process.env["ETH_BUILDERS_ENABLED"] ?? "");
          const isEthereum = network === "ethereum";

          // Fetch current block number for Flashbots bundle targeting.
          // Non-blocking: if it fails we skip bundles gracefully.
          const currentBlockNumber = isEthereum && flashbotsAuthKey
            ? await client.getBlockNumber().catch(() => null)
            : null;

          const [broadcasts] = await Promise.all([
            pool.broadcastUntilAccepted(network, preparedMint.signedTx),
            isEthereum && flashbotsAuthKey && currentBlockNumber != null
              ? sendFlashbotsBundle(preparedMint.signedTx, flashbotsAuthKey, currentBlockNumber)
                  .then((bundleHash) => {
                    if (bundleHash) {
                      void log(prisma, task.id, "info",
                        `Flashbots bundle submitted for wallet ${shortAddress(preparedMint.walletAddress)} targeting blocks ${currentBlockNumber + 1n}–${currentBlockNumber + 2n}.`,
                        { bundleHash, walletId: preparedMint.walletId },
                      ).catch(() => undefined);
                    }
                  })
                  .catch(() => undefined)
              : Promise.resolve(),
            isEthereum && buildersEnabled
              ? sendToFreeBuilders(preparedMint.signedTx)
                  .then(() => {
                    void log(prisma, task.id, "info",
                      `Free builders (beaverbuild/rsync/Titan) submitted for wallet ${shortAddress(preparedMint.walletAddress)}.`,
                      { walletId: preparedMint.walletId },
                    ).catch(() => undefined);
                  })
                  .catch(() => undefined)
              : Promise.resolve(),
          ]);
          const successful = broadcasts.find((result) => result.ok && result.hash);
          const alreadyKnown = broadcasts.some((result) =>
            /already known|known transaction|already imported/i.test(
              result.error ?? "",
            ),
          );
          const hash = successful?.hash ?? (alreadyKnown ? keccak256(preparedMint.signedTx) : undefined);

          if (!hash) {
            throw new Error(
              broadcasts
                .map((item) => item.error)
                .filter(Boolean)
                .join("; ") || "RPC broadcast did not return a transaction hash.",
            );
          }

          const tx = await prisma.transaction.create({
            data: {
              mintTaskId: task.id,
              walletId: preparedMint.walletId,
              network: task.collection.chain,
              status: "BROADCAST",
              txHash: hash,
              nonce: preparedMint.nonce,
              gasFeeWei: (
                preparedMint.gasLimit * preparedMint.maxFeePerGas
              ).toString(),
            },
          });
          await log(
            prisma,
            task.id,
            "info",
            `Broadcast accepted for wallet ${shortAddress(preparedMint.walletAddress)}.`,
            { txHash: hash, elapsedMs: Date.now() - broadcastStartedAt },
          );
          return { ...preparedMint, transactionId: tx.id, hash, allHashes: [hash] } satisfies BroadcastedMint;
        } catch (error) {
          await failWallet(
            prisma,
            task.id,
            preparedMint.taskWalletId,
            preparedMint.walletId,
            error,
            "broadcast",
          );
          return null;
        }
      }),
    );

    const broadcasted = broadcastResults.filter(
      (item): item is BroadcastedMint => item !== null,
    );

    if (broadcasted.length === 0) {
      await finishTask(prisma, task.id, "FAILED", "Mint task failed.");
      return;
    }

    // ── Supply watcher: cancel tx if contract sells out before block inclusion ──
    // Polls totalSupply() on the NFT contract every 300ms after broadcast.
    // If supply exhausted, replaces each pending mint tx with a cheap self-transfer
    // (same nonce, higher gas) so the mint tx is dropped and gas is saved.
    const contractAddress = task.collection.contractAddress as `0x${string}`;
    const supplyCheckEnabled = /^(1|true|yes)$/i.test(
      process.env["MINT_SUPPLY_WATCH_ENABLED"] ?? "true",
    );
    const supplyWatchIntervalMs = numberEnv("MINT_SUPPLY_WATCH_INTERVAL_MS", 300);

    // Shared cancellation signal — flipped when supply = 0 detected.
    let supplyExhausted = false;

    // Prefer stage max supply from OpenSea (avoids contract RPC call).
    // Falls back to on-chain maxSupply() if not available from pre-arm.
    const knownMaxSupply: bigint | null =
      broadcasted.find((b) => b.stageMaxSupply != null)?.stageMaxSupply ?? null;

    const watchSupply = async () => {
      if (!supplyCheckEnabled) return;
      try {
        const totalSupply = await (
          client.readContract({
            address: contractAddress,
            abi: ERC721_SUPPLY_ABI,
            functionName: "totalSupply",
          }) as Promise<bigint>
        );

        // Use stage supply from OpenSea if we have it — no extra RPC call.
        const maxSupply: bigint | null = knownMaxSupply !== null
          ? knownMaxSupply
          : await (
              client.readContract({
                address: contractAddress,
                abi: ERC721_SUPPLY_ABI,
                functionName: "maxSupply",
              }).catch(() =>
                client.readContract({
                  address: contractAddress,
                  abi: ERC721_SUPPLY_ABI,
                  functionName: "_maxSupply",
                }).catch(() => null),
              ) as Promise<bigint | null>
            );

        if (maxSupply != null && totalSupply >= maxSupply) {
          supplyExhausted = true;
          void log(prisma, task.id, "warn",
            `Supply exhausted on-chain (${totalSupply}/${maxSupply}) — cancelling pending mint txs to save gas.`,
          ).catch(() => undefined);
        }
      } catch {
        // non-fatal — supply check best-effort only
      }
    };

    // Poll supply until exhausted or all receipts received.
    let supplyWatchStopped = false;
    const supplyWatchLoop = (async () => {
      while (!supplyWatchStopped && !supplyExhausted) {
        await delay(supplyWatchIntervalMs);
        await watchSupply();
      }
    })();

    const receiptResults: ReceiptOutcome[] = await Promise.all(
      broadcasted.map(async (item): Promise<ReceiptOutcome> => {
        try {
          await prisma.transaction.update({
            where: { id: item.transactionId },
            data: { status: "PENDING" },
          });

          // ── Gas bump loop ──────────────────────────────────────────────
          // If tx is not included in the first block, bump gas and re-broadcast
          // on the same nonce. MINT_BUMP_WINDOW_MS controls how long we keep
          // trying (default: 1 block time — 12s ETH, 3s Base).
          // After the window, we stop bumping and wait for the original receipt.
          const gasSettings = resolveGasSettings(task.gasSettingsJson, null);
          const bumpWindowMs = numberEnv(
            "MINT_BUMP_WINDOW_MS",
            network === "ethereum" ? 13_000 : 3_000,
          );
          const bumpDeadline = Date.now() + bumpWindowMs;
          let activeMint = item;

          if (gasSettings.gasBumpEnabled) {
            let bumpAttempt = 0;
            while (bumpAttempt < gasSettings.maxBumpAttempts && Date.now() < bumpDeadline) {
              // Wait for the next block before deciding to bump.
              // Uses WSS newHeads subscription for exact block-mine timing (2-3s faster
              // than a hardcoded delay). Falls back to HTTP poll interval if no WSS URL.
              await waitForNextBlock(network, bumpDeadline);
              if (Date.now() >= bumpDeadline) break;

              // If supply exhausted — cancel the pending tx instead of bumping.
              // Send a cheap self-transfer with the same nonce to replace the mint tx.
              if (supplyExhausted) {
                try {
                  const privateKey = await decryptPrivateKey(
                    activeMint.walletCrypto,
                    { masterKey: env("ENCRYPTION_MASTER_KEY") },
                  );
                  const cancelTx = await signTransaction(
                    { chainName: network, rpcUrl: primary.url },
                    privateKey,
                    {
                      to: activeMint.walletAddress,
                      data: "0x",
                      value: 0n,
                      gas: 21_000n,
                      nonce: activeMint.nonce,
                      // 120% of current maxFee to outbid the mint tx.
                      maxFeePerGas: (activeMint.maxFeePerGas * 120n) / 100n,
                      maxPriorityFeePerGas: (activeMint.maxPriorityFeePerGas * 120n) / 100n,
                    },
                  );
                  await pool.broadcastUntilAccepted(network, cancelTx);
                  void log(prisma, task.id, "warn",
                    `Cancelled mint tx for wallet ${shortAddress(activeMint.walletAddress)} — supply exhausted.`,
                    { nonce: activeMint.nonce, walletId: activeMint.walletId },
                  ).catch(() => undefined);
                } catch {
                  // cancel attempt failed — let receipt timeout handle it
                }
                break;
              }

              // Check if already confirmed — no bump needed.
              try {
                const receipt = await client.getTransactionReceipt({
                  hash: activeMint.hash,
                });
                if (receipt) break; // confirmed — exit bump loop
              } catch {
                // not yet confirmed — proceed with bump
              }

              bumpAttempt += 1;
              try {
                const bumpedFees = buildBumpedFees({
                  currentMaxFeePerGas: activeMint.maxFeePerGas,
                  currentPriorityFeePerGas: activeMint.maxPriorityFeePerGas,
                  attempt: bumpAttempt,
                  settings: gasSettings,
                });

                const privateKey = await decryptPrivateKey(
                  activeMint.walletCrypto,
                  { masterKey: env("ENCRYPTION_MASTER_KEY") },
                );
                const bumpedSignedTx = await signTransaction(
                  { chainName: network, rpcUrl: primary.url },
                  privateKey,
                  {
                    to: activeMint.mintPayloadForRetry.to,
                    data: activeMint.mintPayloadForRetry.data,
                    value: activeMint.mintPayloadForRetry.value,
                    gas: activeMint.gasLimit,
                    nonce: activeMint.nonce,
                    maxFeePerGas: bumpedFees.maxFeePerGas,
                    maxPriorityFeePerGas: bumpedFees.maxPriorityFeePerGas,
                  },
                );

                // Rebroadcast bumped tx to all channels in parallel.
                const [bumpBroadcasts] = await Promise.all([
                  pool.broadcastUntilAccepted(network, bumpedSignedTx),
                  network === "ethereum" && process.env["ETH_BUILDERS_ENABLED"]
                    ? sendToFreeBuilders(bumpedSignedTx).catch(() => undefined)
                    : Promise.resolve(),
                ]);

                const bumpSuccess = bumpBroadcasts.find((r) => r.ok && r.hash);
                if (bumpSuccess?.hash) {
                  void log(prisma, task.id, "info",
                    `Gas bump #${bumpAttempt} accepted for wallet ${shortAddress(activeMint.walletAddress)}.`,
                    {
                      bumpedHash: bumpSuccess.hash,
                      maxFeePerGas: bumpedFees.maxFeePerGas.toString(),
                      maxPriorityFeePerGas: bumpedFees.maxPriorityFeePerGas.toString(),
                    },
                  ).catch(() => undefined);
                  activeMint = {
                    ...activeMint,
                    signedTx: bumpedSignedTx,
                    hash: bumpSuccess.hash,
                    maxFeePerGas: bumpedFees.maxFeePerGas,
                    maxPriorityFeePerGas: bumpedFees.maxPriorityFeePerGas,
                    // Track all bumped hashes — any of them may land.
                    allHashes: [...activeMint.allHashes, bumpSuccess.hash],
                  };
                }
              } catch {
                break; // bump limit reached or signing failed — stop bumping
              }
            }
          }
          // ── End gas bump loop ──────────────────────────────────────────

          // Race all known tx hashes (original + bumped) — whichever lands first wins.
          // waitForAnyReceipt polls all in parallel until one is confirmed or timeout.
          const receipt = await waitForAnyReceipt(
            { chainName: network, rpcUrl: primary.url },
            activeMint.allHashes,
            {
              confirmations: receiptConfirmations,
              timeoutMs: receiptTimeoutMs,
            },
          );
          const txStatus =
            receipt.status === "success" ? "CONFIRMED" : "FAILED";
          await prisma.transaction.update({
            where: { id: item.transactionId },
            data: {
              status: txStatus,
              confirmations: receiptConfirmations,
              gasUsedWei: receipt.gasUsed.toString(),
            },
          });
          await prisma.mintTaskWallet.update({
            where: { id: item.taskWalletId },
            data: {
              status: txStatus === "CONFIRMED" ? "success" : "failed",
              progress: 100,
            },
          });
          if (txStatus !== "CONFIRMED") {
            throw new Error("Transaction failed on-chain.");
          }
          const tokenIds = extractTransferTokenIds(receipt.logs, item.walletAddress);
          return { status: "confirmed", tokenIds };
        } catch (error) {
          const pending = isReceiptPending(error);
          await prisma.transaction
            .update({
              where: { id: item.transactionId },
              data: {
                status: pending ? "PENDING" : "FAILED",
                errorMessage: pending ? null : rawErrorMessage(error),
              },
            })
            .catch(() => undefined);
          await prisma.mintTaskWallet
            .update({
              where: { id: item.taskWalletId },
              data: {
                status: pending ? "pending" : "failed",
                progress: pending ? 95 : 100,
              },
            })
            .catch(() => undefined);
          await log(
            prisma,
            task.id,
            pending ? "warn" : "error",
            pending
              ? `Broadcast accepted for ${shortAddress(item.walletAddress)}; confirmation is still pending.`
              : toUserFacingError(error).message,
            {
              stage: "receipt",
              walletId: item.walletId,
              txHash: item.hash,
              rawError: rawErrorMessage(error),
            },
          ).catch(() => undefined);
          return pending ? { status: "pending" } : { status: "failed" };
        }
      }),
    );

    // Stop supply watcher — all receipts received.
    supplyWatchStopped = true;
    await supplyWatchLoop;

    const acceptedMints = receiptResults.filter((r) => r.status !== "failed").length;
    const confirmedMints = receiptResults.filter((r) => r.status === "confirmed").length;
    await queueInstantFlipperIntents(
      prisma,
      openSea,
      task.id,
      task.collection.slug,
      task.collection.contractAddress,
      network,
      primary.url,
      task.instantFlipperJson,
      broadcasted,
      receiptResults,
    );
    await finishTask(
      prisma,
      task.id,
      acceptedMints > 0 ? "COMPLETED" : "FAILED",
      acceptedMints > 0
        ? confirmedMints === broadcasted.length
          ? "Mint task confirmed on-chain."
          : "Mint task broadcast completed; confirmations are still pending."
        : "Mint task failed.",
    );
  } catch (error) {
    const userError = toUserFacingError(error);
    logger.error(
      { taskId: task.id, code: userError.code, rawError: rawErrorMessage(error) },
      "mint task execution failed",
    );
    await prisma.mintTask
      .update({
        where: { id: task.id },
        data: { status: "FAILED", completedAt: new Date() },
      })
      .catch(() => undefined);
    await log(prisma, task.id, "error", userError.message, {
      code: userError.code,
      rawError: rawErrorMessage(error),
    }).catch(() => undefined);
    await queueMintTaskNotification(prisma, task.id, "FAILED", userError.message).catch(() => undefined);
    throw error;
  }
}

// ── Wallet Pre-flight Check ───────────────────────────────────────────────
// Runs during prep phase — before signing — to surface funding and nonce
// issues as early as possible. Warns loudly but does not throw; the
// readiness score system is the authoritative gate that blocks bad wallets.

async function runWalletPreFlight(
  prisma: PrismaClient,
  mintTaskId: string,
  walletId: string,
  walletAddress: string,
  balanceWei: bigint,
  pendingNonce: number,
  confirmedNonce: number | null,
  mintValueWei: bigint,
  gasFees: ResolvedGasFees,
) {
  const issues: string[] = [];

  // ── 1. Stuck transactions ──────────────────────────────────────────────
  // pending nonce > confirmed nonce means there is at least one unconfirmed tx.
  // Multiple stuck txs (gap ≥ 2) are a red flag — they can block the mint tx.
  if (confirmedNonce !== null && pendingNonce > confirmedNonce) {
    const stuckCount = pendingNonce - confirmedNonce;
    issues.push(
      `${stuckCount} stuck pending transaction(s) on this wallet may delay or block the mint tx.`,
    );
  }

  // ── 2. Balance check ──────────────────────────────────────────────────
  // Estimate worst-case gas cost using the configured maxFeePerGas and a
  // conservative fallback gas limit. The readiness score uses actual gas
  // limit later — this is an early warning only.
  const estimatedGasLimit = bigintEnv("MINT_PREFLIGHT_GAS_ESTIMATE", 400_000n);
  const estimatedGasCostWei = estimatedGasLimit * gasFees.maxFeePerGas;
  const estimatedTotalCostWei = mintValueWei + estimatedGasCostWei;
  if (balanceWei < estimatedTotalCostWei) {
    const shortfallWei = estimatedTotalCostWei - balanceWei;
    const shortfallEth = (Number(shortfallWei) / 1e18).toFixed(5);
    issues.push(
      `Wallet balance may be insufficient. Estimated shortfall: ${shortfallEth} ETH (balance ${(Number(balanceWei) / 1e18).toFixed(5)} ETH, estimated cost ${(Number(estimatedTotalCostWei) / 1e18).toFixed(5)} ETH).`,
    );
  }

  if (issues.length > 0) {
    await log(
      prisma,
      mintTaskId,
      "warn",
      `Pre-flight warnings for wallet ${shortAddress(walletAddress)}: ${issues.join(" | ")}`,
      { walletId, pendingNonce, confirmedNonce, balanceWei: balanceWei.toString() },
    ).catch(() => undefined);
  } else {
    await log(
      prisma,
      mintTaskId,
      "info",
      `Pre-flight passed for wallet ${shortAddress(walletAddress)}.`,
      { walletId, pendingNonce, balanceWei: balanceWei.toString() },
    ).catch(() => undefined);
  }
}
// ─────────────────────────────────────────────────────────────────────────

async function resolveEligibility(
  openSea: OpenSeaClient,
  slug: string,
  walletAddress: string,
  phaseType: string,
  warn: (message: string, contextJson?: unknown) => Promise<void>,
): Promise<EligibilityResult> {
  const openSeaPhase = toOpenSeaPhase(phaseType);
  if (openSeaPhase === "public") return { eligible: true, phaseType: "public" };

  try {
    return await openSea.checkEligibility(slug, walletAddress, openSeaPhase);
  } catch (error) {
    await warn(
      `Eligibility check for ${shortAddress(walletAddress)} is unavailable; continuing with mint payload resolution.`,
      { phaseType, rawError: rawErrorMessage(error) },
    );
    return {
      eligible: true,
      phaseType: openSeaPhase,
      reason: "Eligibility check unavailable before mint payload resolution.",
    };
  }
}

async function loadMintPayload(
  openSea: OpenSeaClient,
  collection: {
    slug: string;
    contractAddress: string;
    mintPriceWei: string;
    phases: Array<{
      phaseType: string;
      priceWei: string;
      startTime: Date;
      endTime: Date | null;
    }>;
  },
  phaseType: string,
  walletAddress: string,
  targetAt: Date,
  quantity: number,
  eligibility: EligibilityResult,
  warn: (message: string, contextJson?: unknown) => Promise<void>,
) {
  if (phaseType === "PUBLIC") {
    return createSeaDropPublicMintPayload({
      nftContract: collection.contractAddress as `0x${string}`,
      minter: walletAddress as `0x${string}`,
      mintPriceWei: resolveMintPriceWei(collection, phaseType, targetAt),
      quantity,
    });
  }

  const eligibilityPayload = restrictedPayloadFromEligibility(
    collection.contractAddress,
    walletAddress,
    quantity,
    eligibility,
  );
  if (eligibilityPayload) {
    await warn(
      `Using ${eligibility.signature ? "signed" : "allowlist"} SeaDrop mint payload for ${shortAddress(walletAddress)}.`,
      { phaseType },
    );
    return eligibilityPayload;
  }

  try {
    return await openSea.getMintPayload(
      collection.slug,
      walletAddress,
      quantity,
      toOpenSeaPhase(phaseType),
    );
  } catch (error) {
    const msUntilOpen = targetAt.getTime() - Date.now();
    if (msUntilOpen <= 1_000) throw error;

    await warn(
      `Mint payload for ${shortAddress(walletAddress)} is not available before open; retrying at target time.`,
      { rawError: rawErrorMessage(error), targetAt: targetAt.toISOString() },
    );
    await sleepUntil(targetAt);

    const refreshedEligibility = await openSea
      .checkEligibility(collection.slug, walletAddress, toOpenSeaPhase(phaseType))
      .catch(() => eligibility);
    const refreshedEligibilityPayload = restrictedPayloadFromEligibility(
      collection.contractAddress,
      walletAddress,
      quantity,
      refreshedEligibility,
    );
    if (refreshedEligibilityPayload) {
      await warn(
        `Using refreshed ${refreshedEligibility.signature ? "signed" : "allowlist"} SeaDrop mint payload for ${shortAddress(walletAddress)}.`,
        { phaseType },
      );
      return refreshedEligibilityPayload;
    }

    try {
      return await openSea.getMintPayload(
        collection.slug,
        walletAddress,
        quantity,
        toOpenSeaPhase(phaseType),
      );
    } catch (retryError) {
      throw new Error(
        `Mint payload is unavailable for ${phaseType}. OpenSea did not return transaction data, proof, or signature. Last error: ${rawErrorMessage(retryError)}`,
      );
    }
  }
}

function restrictedPayloadFromEligibility(
  contractAddress: string,
  walletAddress: string,
  quantity: number,
  eligibility: EligibilityResult,
): MintPayload | undefined {
  if (eligibility.payload) return eligibility.payload;

  if (eligibility.mintParams && eligibility.proof) {
    return createSeaDropAllowListMintPayload({
      nftContract: contractAddress as `0x${string}`,
      minter: walletAddress as `0x${string}`,
      mintParams: eligibility.mintParams,
      proof: eligibility.proof as Hex[],
      quantity,
    });
  }

  if (eligibility.mintParams && eligibility.signature && eligibility.salt) {
    return createSeaDropSignedMintPayload({
      nftContract: contractAddress as `0x${string}`,
      minter: walletAddress as `0x${string}`,
      mintParams: eligibility.mintParams,
      salt: eligibility.salt,
      signature: eligibility.signature,
      quantity,
    });
  }

  return undefined;
}

function resolveMintPriceWei(
  collection: {
    mintPriceWei: string;
    phases: Array<{
      phaseType: string;
      priceWei: string;
      startTime: Date;
      endTime: Date | null;
    }>;
  },
  phaseType: string,
  targetAt: Date,
) {
  const targetMs = targetAt.getTime();
  const matchingPhases = collection.phases.filter(
    (phase) => phase.phaseType === phaseType,
  );
  const activeAtTarget = matchingPhases.find((phase) => {
    const startMs = phase.startTime.getTime();
    const endMs = phase.endTime?.getTime();
    return startMs <= targetMs && (endMs == null || endMs >= targetMs);
  });

  return activeAtTarget?.priceWei ?? matchingPhases[0]?.priceWei ?? collection.mintPriceWei;
}

async function resolveGasLimit(
  options: { chainName: "base" | "ethereum"; rpcUrl: string },
  request: {
    account: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
  },
  targetAt: Date,
  warn: (message: string, contextJson?: unknown) => Promise<void>,
): Promise<{ gasLimit: bigint; simulationFailed: boolean }> {
  try {
    const simulation = await simulateTx(options, request);
    return { gasLimit: simulation.estimatedGas, simulationFailed: false };
  } catch (error) {
    const msUntilOpen = targetAt.getTime() - Date.now();
    if (msUntilOpen <= 500) throw error;

    const fallbackGasLimit = bigintEnv("MINT_FALLBACK_GAS_LIMIT", 350_000n);
    await warn(
      "Pre-open simulation is not accepted yet; using fallback gas limit for instant broadcast.",
      {
        rawError: rawErrorMessage(error),
        fallbackGasLimit: fallbackGasLimit.toString(),
      },
    );
    return { gasLimit: fallbackGasLimit, simulationFailed: true };
  }
}

async function waitWithRollingSimulation(
  prisma: PrismaClient,
  mintTaskId: string,
  prepared: PreparedMint[],
  targetAt: Date,
  options: { chainName: "base" | "ethereum"; rpcUrl: string },
): Promise<PreparedMint[]> {
  const pollIntervalMs = numberEnv("MINT_SIM_POLL_INTERVAL_MS", 5_000);
  const lastChanceTimeoutMs = numberEnv("MINT_SIM_LAST_CHANCE_TIMEOUT_MS", 400);

  // Track which wallets still need simulation to pass.
  const stillFailing = new Set(
    prepared.filter((p) => p.simulationFailed).map((p) => p.taskWalletId),
  );
  // Mutable confirmed-pass set — flipped during polling.
  const passedDuringWait = new Set<string>();

  const waitMs = targetAt.getTime() - Date.now();
  if (waitMs > 0) {
    const fallbackCount = stillFailing.size;
    await log(
      prisma,
      mintTaskId,
      "info",
      fallbackCount > 0
        ? `Prepared ${prepared.length} signed tx. Waiting for target open time. Polling simulation for ${fallbackCount} wallet(s) using fallback gas.`
        : `Prepared ${prepared.length} signed tx. Waiting for target open time.`,
      { targetAt: targetAt.toISOString(), waitMs },
    );
  }

  // ── Rolling poll: runs concurrently with sleepUntil ──────────────────
  const pollLoop = async () => {
    while (stillFailing.size > 0 && Date.now() < targetAt.getTime() - 2_000) {
      await delay(Math.min(pollIntervalMs, Math.max(0, targetAt.getTime() - Date.now() - 2_000)));
      if (Date.now() >= targetAt.getTime() - 2_000) break;

      await Promise.all(
        prepared
          .filter((p) => stillFailing.has(p.taskWalletId))
          .map(async (p) => {
            try {
              await simulateTx(options, {
                account: p.walletAddress,
                ...p.mintPayloadForRetry,
              });
              stillFailing.delete(p.taskWalletId);
              passedDuringWait.add(p.taskWalletId);
              await log(
                prisma,
                mintTaskId,
                "info",
                `Simulation now passing for wallet ${shortAddress(p.walletAddress)} — will broadcast at phase open with no delay.`,
                { walletId: p.walletId },
              );
            } catch {
              // Still pre-open or not yet accepted — keep polling.
            }
          }),
      );
    }
  };

  await Promise.all([sleepUntil(targetAt), pollLoop()]);
  // ─────────────────────────────────────────────────────────────────────

  // ── Re-sign with fresh nonce (T-0) ────────────────────────────────────
  // Nonces were fetched during prep — potentially minutes ago. Re-signing
  // here guarantees the TX has the correct nonce regardless of what happened
  // in the interim. Runs after sleep so it adds zero delay to broadcast.
  const resigned = await refreshSignatures(prisma, mintTaskId, prepared, options);
  // ─────────────────────────────────────────────────────────────────────

  // ── Last-chance attempt for wallets that never passed during the wait ─
  // We allow only MINT_SIM_LAST_CHANCE_TIMEOUT_MS (default 400ms) so that
  // wallets that are clearly going to revert get skipped while adding
  // negligible delay for the rest.
  const skippedIds = new Set<string>();
  if (stillFailing.size > 0) {
    await log(
      prisma,
      mintTaskId,
      "info",
      `Phase open reached with ${stillFailing.size} wallet(s) whose simulation never passed. Running last-chance check (${lastChanceTimeoutMs}ms timeout).`,
    );

    await Promise.all(
      resigned
        .filter((p) => stillFailing.has(p.taskWalletId))
        .map(async (p) => {
          try {
            await Promise.race([
              simulateTx(options, { account: p.walletAddress, ...p.mintPayloadForRetry }),
              delay(lastChanceTimeoutMs).then(() => {
                throw new Error(`simulation timeout after ${lastChanceTimeoutMs}ms`);
              }),
            ]);
            passedDuringWait.add(p.taskWalletId);
            await log(
              prisma,
              mintTaskId,
              "info",
              `Last-chance simulation passed for wallet ${shortAddress(p.walletAddress)}.`,
              { walletId: p.walletId },
            );
          } catch (error) {
            skippedIds.add(p.taskWalletId);
            await log(
              prisma,
              mintTaskId,
              "error",
              `Simulation still failing for wallet ${shortAddress(p.walletAddress)} at phase open. Skipping broadcast to avoid gas loss.`,
              { walletId: p.walletId, rawError: rawErrorMessage(error) },
            );
            await prisma.mintTaskWallet
              .update({
                where: { id: p.taskWalletId },
                data: { status: "failed", errorCode: "SIMULATION_REJECTED", progress: 100 },
              })
              .catch(() => undefined);
          }
        }),
    );
  }
  // ─────────────────────────────────────────────────────────────────────

  return resigned
    .filter((p) => !skippedIds.has(p.taskWalletId))
    .map((p) =>
      passedDuringWait.has(p.taskWalletId) ? { ...p, simulationFailed: false } : p,
    );
}

async function refreshSignatures(
  prisma: PrismaClient,
  mintTaskId: string,
  items: PreparedMint[],
  options: { chainName: "base" | "ethereum"; rpcUrl: string },
): Promise<PreparedMint[]> {
  const client = createMintPublicClient(options);
  return Promise.all(
    items.map(async (item) => {
      try {
        const currentNonce = await client.getTransactionCount({
          address: item.walletAddress,
          blockTag: "pending",
        });
        if (currentNonce !== item.nonce) {
          await log(
            prisma,
            mintTaskId,
            "warn",
            `Nonce drift for wallet ${shortAddress(item.walletAddress)}: signed=${item.nonce}, current=${currentNonce}. Re-signing with fresh nonce.`,
            { walletId: item.walletId, oldNonce: item.nonce, newNonce: currentNonce },
          );
        }
        const privateKey = await decryptPrivateKey(item.walletCrypto, {
          masterKey: env("ENCRYPTION_MASTER_KEY"),
        });
        const signedTx = await signTransaction(options, privateKey, {
          to: item.mintPayloadForRetry.to,
          data: item.mintPayloadForRetry.data,
          value: item.mintPayloadForRetry.value,
          gas: item.gasLimit,
          nonce: currentNonce,
          maxFeePerGas: item.maxFeePerGas,
          maxPriorityFeePerGas: item.maxPriorityFeePerGas,
        });
        return { ...item, signedTx, nonce: currentNonce };
      } catch (error) {
        await log(
          prisma,
          mintTaskId,
          "warn",
          `Could not refresh signature for wallet ${shortAddress(item.walletAddress)}. Using original signed TX.`,
          { walletId: item.walletId, rawError: rawErrorMessage(error) },
        );
        return item;
      }
    }),
  );
}

async function failWallet(
  prisma: PrismaClient,
  mintTaskId: string,
  taskWalletId: string,
  walletId: string,
  error: unknown,
  stage: string,
) {
  const userError = toUserFacingError(error);
  logger.warn(
    { taskId: mintTaskId, walletId, code: userError.code, stage },
    "wallet execution failed",
  );
  await prisma.mintTaskWallet
    .update({
      where: { id: taskWalletId },
      data: { status: "failed", errorCode: userError.code, progress: 100 },
    })
    .catch(() => undefined);
  await log(prisma, mintTaskId, "error", userError.message, {
    code: userError.code,
    stage,
    rawError: rawErrorMessage(error),
  }).catch(() => undefined);
}

async function finishTask(
  prisma: PrismaClient,
  taskId: string,
  status: "COMPLETED" | "FAILED",
  message: string,
) {
  await prisma.mintTask.update({
    where: { id: taskId },
    data: { status, completedAt: new Date() },
  });
  await log(prisma, taskId, status === "COMPLETED" ? "info" : "error", message);
  await upsertPostMintReport(prisma, taskId).catch((error) =>
    log(prisma, taskId, "warn", "Post-mint report could not be generated.", {
      rawError: rawErrorMessage(error),
    }).catch(() => undefined),
  );
  await queueMintTaskNotification(prisma, taskId, status, message).catch((error) =>
    log(prisma, taskId, "warn", "Notification could not be queued.", {
      rawError: rawErrorMessage(error),
    }).catch(() => undefined),
  );
}

async function queueMintTaskNotification(
  prisma: PrismaClient,
  taskId: string,
  status: "COMPLETED" | "FAILED",
  message: string,
) {
  const task = await prisma.mintTask.findUnique({
    where: { id: taskId },
    include: {
      collection: true,
      wallets: true,
      transactions: true,
    },
  });
  if (!task) return;

  const event = status === "COMPLETED" ? "MINT_SUCCESS" : "MINT_FAILED";
  const successfulMints = task.transactions.filter((tx) => tx.status === "CONFIRMED").length;
  const failedMints = Math.max(
    task.transactions.filter((tx) => tx.status === "FAILED").length,
    task.wallets.filter((wallet) => wallet.status === "failed").length,
  );
  const queue = new Queue("notifications-queue", {
    connection: { url: env("REDIS_URL") },
  });

  try {
    await queue.add(
      event.toLowerCase(),
      {
        userId: task.userId,
        event,
        payload: {
          taskId: task.id,
          collectionSlug: task.collection.slug,
          collectionName: task.collection.name,
          network: task.collection.chain,
          status,
          message,
          wallets: task.wallets.length,
          successfulMints,
          failedMints,
        },
      },
      {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function upsertPostMintReport(prisma: PrismaClient, taskId: string) {
  const task = await prisma.mintTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { wallets: true, transactions: true },
  });
  const successful = task.transactions.filter((tx) => tx.status === "CONFIRMED");
  const failedTransactions = task.transactions.filter((tx) => tx.status === "FAILED");
  const failedWallets = task.wallets.filter((wallet) => wallet.status === "failed");
  const totalGas = task.transactions.reduce((sum, tx) => sum + BigInt(tx.gasFeeWei ?? "0"), 0n);
  const confirmationTimes = successful
    .map((tx) => tx.updatedAt.getTime() - tx.createdAt.getTime())
    .filter((ms) => ms > 0);
  const avgConfirmationTimeSec =
    confirmationTimes.length > 0
      ? confirmationTimes.reduce((sum, ms) => sum + ms, 0) / confirmationTimes.length / 1000
      : 0;
  const failedMints = Math.max(failedTransactions.length, failedWallets.length);
  const failureReasons =
    failedWallets.length > 0
      ? failedWallets.map((wallet) => wallet.errorCode ?? "Unknown")
      : failedTransactions.map((tx) => tx.errorMessage ?? tx.errorCode ?? "Unknown");
  const txHashes = successful.map((tx) => tx.txHash).filter(Boolean);

  await prisma.postMintReport.upsert({
    where: { mintTaskId: taskId },
    create: {
      mintTaskId: taskId,
      totalWallets: task.wallets.length,
      successfulMints: successful.length,
      failedMints,
      totalGasSpentWei: totalGas.toString(),
      avgConfirmationTimeSec,
      failureReasonsJson: failureReasons,
      txHashesJson: txHashes,
    },
    update: {
      totalWallets: task.wallets.length,
      successfulMints: successful.length,
      failedMints,
      totalGasSpentWei: totalGas.toString(),
      avgConfirmationTimeSec,
      failureReasonsJson: failureReasons,
      txHashesJson: txHashes,
    },
  });
}

async function log(
  prisma: PrismaClient,
  mintTaskId: string,
  level: string,
  message: string,
  contextJson?: unknown,
) {
  await prisma.taskLog.create({
    data: { mintTaskId, level, message, contextJson: contextJson as object },
  });
}

// ── Flashbots + Multi-builder broadcast ───────────────────────────────────
//
// Free block builders that cover ~75% of Ethereum blocks:
//   Flashbots  relay.flashbots.net   ~10%  (needs auth key)
//   beaverbuild rpc.beaverbuild.org  ~40%  (free, no auth)
//   rsync       rsync-builder.xyz    ~10%  (free, no auth)
//   Titan       rpc.titanbuilder.xyz ~15%  (free, no auth)
//
// All run in parallel at T=0. First accepted = TX in mempool.
// Enable via .env:
//   ETH_FLASHBOTS_AUTH_KEY=0x...   (any ETH private key — for auth only)
//   ETH_BUILDERS_ENABLED=true      (enables beaverbuild + rsync + titan)

async function sendFlashbotsBundle(
  signedTx: Hex,
  authKey: Hex,
  targetBlockNumber: bigint,
): Promise<Hex | null> {
  const endpoint = "https://relay.flashbots.net";

  // eth_sendBundle targets a SPECIFIC block — guaranteed inclusion attempt
  // in that block rather than "whenever" with eth_sendPrivateTransaction.
  // We target currentBlock+1 (next block) and also currentBlock+2 as fallback
  // by sending two bundles in parallel.
  const sendBundle = async (blockNumber: bigint) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendBundle",
      params: [
        {
          txs: [signedTx],
          blockNumber: `0x${blockNumber.toString(16)}`,
        },
      ],
    });

    const account = privateKeyToAccount(authKey);
    const sig = await account.signMessage({
      message: { raw: keccak256(toBytes(body)) },
    });
    const authHeader = `${account.address}:${sig}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flashbots-Signature": authHeader,
      },
      body,
      signal: AbortSignal.timeout(3_000),
    });

    const json = await res.json() as { result?: { bundleHash?: string }; error?: { message: string } };
    if (json.error) throw new Error(`Flashbots bundle: ${json.error.message}`);
    return (json.result?.bundleHash ?? null) as Hex | null;
  };

  // Target next 3 blocks in parallel — N+1, N+2, N+3 for max coverage.
  const [hash] = await Promise.allSettled([
    sendBundle(targetBlockNumber + 1n),
    sendBundle(targetBlockNumber + 2n),
    sendBundle(targetBlockNumber + 3n),
  ]);

  return hash.status === "fulfilled" ? hash.value : null;
}

// Free builders — no auth required, standard JSON-RPC.
// Combined coverage: beaverbuild ~40% + rsync ~10% + Titan ~15%
//                 + Ultra Sound ~8% + Agnostic ~5% + BuildAI ~5% ≈ 83%
const FREE_BUILDER_ENDPOINTS = [
  { name: "beaverbuild",   url: "https://rpc.beaverbuild.org" },
  { name: "rsync-builder", url: "https://rsync-builder.xyz" },
  { name: "Titan Builder", url: "https://rpc.titanbuilder.xyz" },
  { name: "Ultra Sound",   url: "https://rpc.ultrasound.money" },
  { name: "Agnostic",      url: "https://agnostic-relay.net" },
  { name: "BuildAI",       url: "https://buildai.flashbots.net" },
] as const;

async function sendToFreeBuilders(signedTx: Hex): Promise<void> {
  await Promise.allSettled(
    FREE_BUILDER_ENDPOINTS.map(async ({ url }) => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [signedTx],
      });
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(2_000),
      });
    }),
  );
}
// ──────────────────────────────────────────────────────────────────────────

// ── WebSocket block subscription ───────────────────────────────────────────
//
// waitForNextBlock() replaces the hardcoded `delay(12_000)` in the gas bump
// loop with a real-time newHeads subscription via ETH_WS_RPC / BASE_WS_RPC.
//
// Why: ETH blocks arrive at irregular intervals (9-15s). A fixed 12s sleep
// consistently misses the exact mine moment — you either bump too early
// (wasted RPC call) or too late (lost block slot). With WSS you react
// within ~50ms of the block landing, giving 2-3s faster bump execution.
//
// Fallback: if no WSS URL is configured the loop degrades gracefully to a
// timed delay matching the average block time.
//
// .env:
//   ETH_WS_RPC=wss://eth-mainnet.g.alchemy.com/v2/<KEY>
//   BASE_WS_RPC=wss://base-mainnet.g.alchemy.com/v2/<KEY>

async function waitForNextBlock(
  network: "ethereum" | "base",
  deadlineMs: number,
): Promise<void> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) return;

  const wsUrl =
    network === "ethereum"
      ? process.env["ETH_WS_RPC"]
      : process.env["BASE_WS_RPC"];

  if (wsUrl) {
    try {
      await new Promise<void>((resolve, reject) => {
        // Hard deadline: resolve (not reject) so bump loop can check and exit.
        const deadlineTimer = setTimeout(resolve, remainingMs);

        let unwatch: (() => void) | undefined;
        const client = createPublicClient({
          chain: network === "ethereum" ? mainnet : viemBase,
          transport: webSocket(wsUrl, {
            reconnect: false,        // single-shot — we only need one block
            keepAlive: false,
          }),
        });

        unwatch = client.watchBlocks({
          emitOnBegin: false,        // don't fire for the current block
          onBlock: () => {
            clearTimeout(deadlineTimer);
            try { unwatch?.(); } catch { /* ignore */ }
            resolve();
          },
          onError: (err) => {
            clearTimeout(deadlineTimer);
            try { unwatch?.(); } catch { /* ignore */ }
            reject(err);
          },
        });
      });
      return;
    } catch {
      // WSS failed — fall through to timed delay below.
    }
  }

  // Fallback: timed delay matching average block time.
  const pollMs = network === "ethereum" ? 12_000 : 2_000;
  await delay(Math.min(pollMs, remainingMs));
}
// ──────────────────────────────────────────────────────────────────────────

// ── Multi-hash receipt racing ──────────────────────────────────────────────
//
// When gas bumping produces multiple hashes for the same nonce, the first one
// that lands in a block wins — all others are automatically dropped.
// waitForAnyReceipt races all known hashes and returns the first confirmed receipt.

async function waitForAnyReceipt(
  options: { chainName: "base" | "ethereum"; rpcUrl: string },
  hashes: Hex[],
  { confirmations, timeoutMs }: { confirmations: number; timeoutMs: number },
) {
  if (hashes.length === 1) {
    return waitForReceipt(options, hashes[0], { confirmations, timeoutMs });
  }

  // Poll all hashes in parallel — short circuit on first confirmed receipt.
  return new Promise<Awaited<ReturnType<typeof waitForReceipt>>>((resolve, reject) => {
    let settled = false;
    const deadline = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Receipt timeout after ${timeoutMs}ms for ${hashes.length} hashes.`));
      }
    }, timeoutMs);

    for (const hash of hashes) {
      waitForReceipt(options, hash, { confirmations, timeoutMs })
        .then((receipt) => {
          if (!settled) {
            settled = true;
            clearTimeout(deadline);
            resolve(receipt);
          }
        })
        .catch(() => {
          // This hash didn't land — another hash may still succeed.
        });
    }
  });
}
// ──────────────────────────────────────────────────────────────────────────

// ── Utility helpers ───────────────────────────────────────────────────────

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numberEnv(name: string, fallback: number) {
  return numberOrDefault(process.env[name], fallback);
}

function bigintEnv(name: string, fallback: bigint) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try { return BigInt(raw); } catch { return fallback; }
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isReceiptPending(error: unknown) {
  return /timeout|timed out|not found|could not find/i.test(rawErrorMessage(error));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function toOpenSeaPhase(phaseType: string) {
  const normalized = phaseType.toLowerCase();
  if (normalized === "allowlist" || normalized === "gtd" || normalized === "fcfs") return normalized;
  return "public";
}

function rpcUrlsFor(network: "base" | "ethereum"): string[] {
  const prefix = network === "base" ? "BASE" : "ETH";
  return [
    env(`${prefix}_RPC_PRIMARY`),
    process.env[`${prefix}_RPC_BACKUP_1`],
    process.env[`${prefix}_RPC_BACKUP_2`],
  ].filter(Boolean) as string[];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );
  return results;
}

// ── Bot Warfare ───────────────────────────────────────────────────────────

interface CompetitionResult {
  detected: boolean;
  competitorCount: number;
  recommendedMaxFeeGwei: number;
  spikeFactor: number;
}

async function detectBotCompetition(
  prisma: PrismaClient,
  mintTaskId: string,
  collectionSlug: string,
  chain: "BASE" | "ETHEREUM",
  currentGas: { baseFeePerGas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
): Promise<CompetitionResult> {
  // Tuned thresholds: detect earlier (1.3×) and boost harder (1.5×).
  // Use 1min snapshot window instead of 5min — faster spike detection.
  const SPIKE_THRESHOLD = numberOrDefault(process.env["BOT_WARFARE_SPIKE_THRESHOLD"], 1.3);
  const BOOST_MULTIPLIER = numberOrDefault(process.env["BOT_WARFARE_BOOST_MULTIPLIER"], 1.5);

  let detected = false;
  let competitorCount = 0;
  let spikeFactor = 1;
  let recommendedMaxFeeGwei = Number(currentGas.maxFeePerGas / 1_000_000_000n);

  try {
    // 1min window (was 5min) — catches gas spikes much faster.
    const oneMinuteAgo = new Date(Date.now() - 60 * 1_000);
    const snapshots = await prisma.gasSnapshot.findMany({
      where: { network: chain, createdAt: { gte: oneMinuteAgo } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (snapshots.length >= 2) {
      const avgBaseFee =
        snapshots.reduce((sum, s) => sum + BigInt(s.baseFeeWei), 0n) /
        BigInt(snapshots.length);

      if (avgBaseFee > 0n) {
        spikeFactor = Number(currentGas.baseFeePerGas * 100n / avgBaseFee) / 100;
        if (spikeFactor >= SPIKE_THRESHOLD) {
          detected = true;
          competitorCount = Math.max(1, Math.round((spikeFactor - 1) * 5));
          recommendedMaxFeeGwei = Math.ceil(
            Number(currentGas.maxFeePerGas / 1_000_000_000n) * BOOST_MULTIPLIER,
          );
        }
      }
    }
  } catch {
    // non-fatal — continue mint even if competition check fails
  }

  await prisma.botCompetitionLog
    .create({
      data: {
        mintTaskId,
        network: chain,
        collectionSlug,
        competitorCount,
        detectedGasWei: currentGas.baseFeePerGas.toString(),
        recommendedGasWei: (BigInt(recommendedMaxFeeGwei) * 1_000_000_000n).toString(),
        gasAdjusted: detected,
      },
    })
    .catch(() => undefined);

  return { detected, competitorCount, recommendedMaxFeeGwei, spikeFactor };
}

function applyCompetitionBoost(
  settings: GasSettings,
  competition: CompetitionResult,
): GasSettings {
  if (!competition.detected) return settings;
  // Boost both maxFee AND priorityFee proportional to spike factor (capped 3×).
  const priorityBoost = Math.min(competition.spikeFactor, 3);
  return {
    ...settings,
    maxFeeGwei: Math.max(settings.maxFeeGwei, competition.recommendedMaxFeeGwei),
    priorityFeeGwei: settings.priorityFeeGwei * priorityBoost,
  };
}

function applyOfferRatioOverride(
  settings: GasSettings,
  override: { maxFeeGwei: number } | null,
): GasSettings {
  if (!override) return settings;
  // Offer/floor ratio override: take the higher of existing cap and the ratio-derived cap.
  return {
    ...settings,
    maxFeeGwei: Math.max(settings.maxFeeGwei, override.maxFeeGwei),
  };
}

// ─────────────────────────────────────────────────────────────────────────

function resolveTargetAt(runAt: string | undefined, scheduledAt: Date | null) {
  if (runAt) {
    const targetAt = new Date(runAt);
    if (!Number.isNaN(targetAt.getTime())) return targetAt;
  }
  return scheduledAt ?? new Date();
}

function resolveGasSettings(
  taskSettings: unknown,
  walletSettings: unknown,
): GasSettings {
  const settings = (walletSettings ?? taskSettings ?? {}) as Partial<GasSettings>;
  const mode = settings.mode ?? "aggressive";
  // Fall back to engine presets — these are conservative live-gas-aware values,
  // NOT the old hardcoded 200/15 gwei floors that caused massive over-gassing.
  const preset = presetGasSettings(mode);
  return {
    mode,
    maxFeeGwei: numberOrDefault(settings.maxFeeGwei, preset.maxFeeGwei),
    priorityFeeGwei: numberOrDefault(settings.priorityFeeGwei, preset.priorityFeeGwei),
    maxTotalGasCostEth: numberOrDefault(settings.maxTotalGasCostEth, preset.maxTotalGasCostEth),
    gasGuardianEnabled: settings.gasGuardianEnabled ?? true,
    gasBumpEnabled: settings.gasBumpEnabled ?? preset.gasBumpEnabled,
    maxBumpAttempts: numberOrDefault(settings.maxBumpAttempts, preset.maxBumpAttempts),
  };
}

function normalizeMintQuantity(value: unknown) {
  const quantity = Math.floor(numberOrDefault(value, 1));
  return Math.max(1, Math.min(quantity, 50));
}

function resolvePriorityMinting(raw: unknown): PriorityMintingSettings {
  if (!isRecord(raw)) return { enabled: false };
  return {
    enabled: Boolean(raw.enabled),
    maxTransactions:
      typeof raw.maxTransactions === "number" && Number.isFinite(raw.maxTransactions)
        ? Math.max(0, Math.floor(raw.maxTransactions))
        : undefined,
    supplyBuffer:
      typeof raw.supplyBuffer === "number" && Number.isFinite(raw.supplyBuffer)
        ? Math.max(0, Math.floor(raw.supplyBuffer))
        : undefined,
    priorityWalletIds: Array.isArray(raw.priorityWalletIds)
      ? raw.priorityWalletIds.map(String)
      : [],
  };
}

async function applyPriorityMinting(
  prisma: PrismaClient,
  taskId: string,
  prepared: PreparedMint[],
  settings: PriorityMintingSettings,
) {
  if (!settings.enabled) return prepared;
  const maxTransactions = settings.maxTransactions;
  if (!maxTransactions || maxTransactions >= prepared.length) {
    await log(prisma, taskId, "info", "Priority minting is enabled; no prepared transactions needed to be skipped.", {
      prepared: prepared.length,
      maxTransactions: maxTransactions ?? null,
    });
    return prepared;
  }

  const ranked = prepared
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftRank = left.item.priorityRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.item.priorityRank ?? Number.MAX_SAFE_INTEGER;
      if (left.item.priorityMint !== right.item.priorityMint) return left.item.priorityMint ? -1 : 1;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    });
  const keep = ranked.slice(0, maxTransactions).map((entry) => entry.item);
  const skipped = ranked.slice(maxTransactions).map((entry) => entry.item);

  await Promise.all(
    skipped.map((item) =>
      prisma.mintTaskWallet.update({
        where: { id: item.taskWalletId },
        data: {
          status: "priority_skipped",
          progress: 100,
          errorCode: "PRIORITY_SUPPLY_CAP",
        },
      }),
    ),
  );
  await log(
    prisma,
    taskId,
    "warn",
    `Priority minting kept ${keep.length} prepared transaction(s) and skipped ${skipped.length} excess transaction(s).`,
    {
      maxTransactions,
      skippedWalletIds: skipped.map((item) => item.walletId),
    },
  );

  return keep;
}

async function queueInstantFlipperIntents(
  prisma: PrismaClient,
  openSea: OpenSeaClient,
  taskId: string,
  collectionSlug: string,
  contractAddress: string,
  network: "ethereum" | "base",
  rpcUrl: string,
  rawSettings: unknown,
  broadcasted: BroadcastedMint[],
  receiptResults: ReceiptOutcome[],
) {
  const settings = resolveInstantFlipper(rawSettings);
  if (!settings.enabled) return;

  // Manual mode: user presses "Flip Now" — don't auto-list here
  if (settings.mode === "manual") {
    await log(prisma, taskId, "info", "Instant Flipper is in manual mode. Press Flip Now on the task to list.");
    return;
  }

  const confirmedItems = broadcasted
    .map((item, i) => ({ item, outcome: receiptResults[i] }))
    .filter((x): x is { item: BroadcastedMint; outcome: Extract<ReceiptOutcome, { status: "confirmed" }> } =>
      x.outcome?.status === "confirmed",
    );

  if (confirmedItems.length === 0) {
    await log(prisma, taskId, "warn", "Instant Flipper: no confirmed mints to list.");
    return;
  }

  let floorPriceEth: number | null = null;
  try {
    const stats = await openSea.getCollectionStats(collectionSlug);
    floorPriceEth = stats.floorPriceEth ? Number(stats.floorPriceEth) : null;
  } catch (error) {
    await log(prisma, taskId, "warn", "Instant Flipper could not load OpenSea floor price.", {
      rawError: rawErrorMessage(error),
    });
  }

  const targetPriceEth = resolveFlipperPrice(settings, floorPriceEth);
  if (targetPriceEth == null) {
    await log(prisma, taskId, "warn", "Instant Flipper: no valid price available. Set a fixed price or ensure floor price is available.", { floorPriceEth });
    return;
  }

  const client = createMintPublicClient({ chainName: network, rpcUrl });

  for (const { item, outcome } of confirmedItems) {
    const maxToList = settings.maxPerWallet ?? outcome.tokenIds.length;
    const tokenIds = outcome.tokenIds.slice(0, maxToList);

    if (tokenIds.length === 0) {
      await log(prisma, taskId, "warn", `Instant Flipper: no Transfer events found for ${shortAddress(item.walletAddress)}.`);
      continue;
    }

    const privateKey = await decryptPrivateKey(item.walletCrypto, {
      masterKey: env("ENCRYPTION_MASTER_KEY"),
    }).catch(() => null);

    if (!privateKey) {
      await log(prisma, taskId, "error", `Instant Flipper: failed to decrypt key for ${shortAddress(item.walletAddress)}.`);
      continue;
    }

    for (const tokenId of tokenIds) {
      try {
        await createSeaportListing(
          openSea, client, network, contractAddress,
          tokenId, targetPriceEth,
          item.walletAddress, privateKey as `0x${string}`,
        );
        await log(prisma, taskId, "info",
          `Instant Flipper listed token #${tokenId} for ${shortAddress(item.walletAddress)} at ${targetPriceEth.toFixed(5)} ETH.`,
          { tokenId: tokenId.toString(), priceEth: targetPriceEth, walletId: item.walletId },
        );
      } catch (err) {
        await log(prisma, taskId, "error",
          `Instant Flipper failed to list token #${tokenId} for ${shortAddress(item.walletAddress)}: ${rawErrorMessage(err)}`,
          { tokenId: tokenId.toString(), rawError: rawErrorMessage(err) },
        );
      }
    }
  }
}

// ── Manual flip job (triggered by "Flip Now" button) ─────────────────────────

interface InstantFlipJob {
  taskId: string;
  manual?: boolean;
}

export async function executeInstantFlipJob(
  job: Job<InstantFlipJob>,
  prisma: PrismaClient,
) {
  const { taskId } = job.data;

  const task = await prisma.mintTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      collection: true,
      wallets: { include: { wallet: true } },
    },
  });

  const openSea = new OpenSeaClient({ apiKey: env("OPENSEA_API_KEY") });
  const network = task.collection.chain === "BASE" ? "base" : "ethereum";
  const rpcUrls = rpcUrlsFor(network);
  const rpcUrl = rpcUrls[0] ?? "";
  const client = createMintPublicClient({ chainName: network, rpcUrl });

  const settings = resolveInstantFlipper(task.instantFlipperJson);
  if (!settings.enabled) {
    await log(prisma, taskId, "warn", "Instant Flipper is not enabled on this task.");
    return;
  }

  // Fetch floor price
  let floorPriceEth: number | null = null;
  try {
    const stats = await openSea.getCollectionStats(task.collection.slug);
    floorPriceEth = stats.floorPriceEth ? Number(stats.floorPriceEth) : null;
  } catch {
    await log(prisma, taskId, "warn", "Instant Flipper could not load OpenSea floor price.");
  }

  const targetPriceEth = resolveFlipperPrice(settings, floorPriceEth);
  if (targetPriceEth == null) {
    await log(prisma, taskId, "warn", "Instant Flipper: no valid price. Set a fixed price or ensure floor is available.", { floorPriceEth });
    return;
  }

  await log(prisma, taskId, "info", `Instant Flipper (manual) starting. Target price: ${targetPriceEth.toFixed(5)} ETH.`);

  // Find confirmed transactions for this task
  const transactions = await prisma.transaction.findMany({
    where: { mintTaskId: taskId, status: "CONFIRMED" },
    select: { txHash: true, walletId: true },
  });

  if (transactions.length === 0) {
    await log(prisma, taskId, "warn", "Instant Flipper: no confirmed transactions found for this task.");
    return;
  }

  for (const tx of transactions) {
    if (!tx.txHash) continue;

    const taskWallet = task.wallets.find((w) => w.walletId === tx.walletId);
    if (!taskWallet) continue;

    const wallet = taskWallet.wallet;

    try {
      const receipt = await client.getTransactionReceipt({ hash: tx.txHash as `0x${string}` });
      const tokenIds = extractTransferTokenIds(receipt.logs, wallet.address as `0x${string}`);

      if (tokenIds.length === 0) {
        await log(prisma, taskId, "warn", `Instant Flipper: no Transfer events found for ${shortAddress(wallet.address)}.`);
        continue;
      }

      const maxToList = settings.maxPerWallet ?? tokenIds.length;
      const toList = tokenIds.slice(0, maxToList);

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

      for (const tokenId of toList) {
        try {
          await createSeaportListing(
            openSea, client, network,
            task.collection.contractAddress,
            tokenId, targetPriceEth,
            wallet.address as `0x${string}`,
            privateKey as `0x${string}`,
          );
          await log(prisma, taskId, "info",
            `Instant Flipper listed token #${tokenId} for ${shortAddress(wallet.address)} at ${targetPriceEth.toFixed(5)} ETH.`,
            { tokenId: tokenId.toString(), priceEth: targetPriceEth },
          );
        } catch (err) {
          await log(prisma, taskId, "error",
            `Instant Flipper failed to list token #${tokenId}: ${rawErrorMessage(err)}`,
            { tokenId: tokenId.toString(), rawError: rawErrorMessage(err) },
          );
        }
      }
    } catch (err) {
      await log(prisma, taskId, "error",
        `Instant Flipper failed to process tx for ${shortAddress(wallet.address)}: ${rawErrorMessage(err)}`,
        { txHash: tx.txHash, rawError: rawErrorMessage(err) },
      );
    }
  }
}

// ── Seaport listing helpers ───────────────────────────────────────────────────

function extractTransferTokenIds(
  logs: readonly { topics: readonly string[] }[],
  walletAddress: `0x${string}`,
): bigint[] {
  const walletTopic = `0x${walletAddress.slice(2).toLowerCase().padStart(64, "0")}`;
  return logs
    .filter(
      (log) =>
        log.topics[0]?.toLowerCase() === TRANSFER_EVENT_TOPIC &&
        log.topics[2]?.toLowerCase() === walletTopic &&
        log.topics[3] != null,
    )
    .map((log) => BigInt(log.topics[3] as string));
}

async function createSeaportListing(
  openSea: OpenSeaClient,
  client: ReturnType<typeof createMintPublicClient>,
  network: "ethereum" | "base",
  contractAddress: string,
  tokenId: bigint,
  priceEth: number,
  walletAddress: `0x${string}`,
  privateKey: `0x${string}`,
): Promise<void> {
  const chainId = SEAPORT_CHAIN_IDS[network] ?? 1;
  const priceWei = BigInt(Math.round(priceEth * 1e18));
  const feeAmount = (priceWei * OPENSEA_FEE_BPS) / 10_000n;
  const sellerAmount = priceWei - feeAmount;

  const nowSec = Math.floor(Date.now() / 1000);
  const startTime = BigInt(nowSec);
  const endTime = BigInt(nowSec + 7 * 24 * 3600); // 7 days
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  // Get Seaport order counter from chain
  const counter = await client.readContract({
    address: SEAPORT_V15_ADDRESS,
    abi: SEAPORT_GET_COUNTER_ABI,
    functionName: "getCounter",
    args: [walletAddress],
  });

  // Build EIP-712 message (bigint for uint256, hex for bytes32/address)
  const message = {
    offerer: walletAddress,
    zone: ZERO_ADDRESS,
    offer: [
      {
        itemType: 2, // ERC721
        token: contractAddress as `0x${string}`,
        identifierOrCriteria: tokenId,
        startAmount: 1n,
        endAmount: 1n,
      },
    ],
    consideration: [
      {
        itemType: 0, // NATIVE
        token: ZERO_ADDRESS,
        identifierOrCriteria: 0n,
        startAmount: sellerAmount,
        endAmount: sellerAmount,
        recipient: walletAddress,
      },
      {
        itemType: 0, // NATIVE — OpenSea fee
        token: ZERO_ADDRESS,
        identifierOrCriteria: 0n,
        startAmount: feeAmount,
        endAmount: feeAmount,
        recipient: OPENSEA_FEE_RECIPIENT,
      },
    ],
    orderType: 0, // FULL_OPEN
    startTime,
    endTime,
    zoneHash: ZERO_BYTES32,
    salt,
    conduitKey: OPENSEA_CONDUIT_KEY,
    counter,
  };

  const account = privateKeyToAccount(privateKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signature = await account.signTypedData({
    domain: {
      name: "Seaport",
      version: "1.5",
      chainId,
      verifyingContract: SEAPORT_V15_ADDRESS,
    },
    types: SEAPORT_EIP712_TYPES,
    primaryType: "OrderComponents",
    message,
  } as Parameters<typeof account.signTypedData>[0]);

  // Build string-form parameters for the OpenSea API
  const parameters: SeaportOrderParameters = {
    offerer: walletAddress,
    zone: ZERO_ADDRESS,
    offer: [
      {
        itemType: 2,
        token: contractAddress,
        identifierOrCriteria: tokenId.toString(),
        startAmount: "1",
        endAmount: "1",
      },
    ],
    consideration: [
      {
        itemType: 0,
        token: ZERO_ADDRESS,
        identifierOrCriteria: "0",
        startAmount: sellerAmount.toString(),
        endAmount: sellerAmount.toString(),
        recipient: walletAddress,
      },
      {
        itemType: 0,
        token: ZERO_ADDRESS,
        identifierOrCriteria: "0",
        startAmount: feeAmount.toString(),
        endAmount: feeAmount.toString(),
        recipient: OPENSEA_FEE_RECIPIENT,
      },
    ],
    orderType: 0,
    startTime: startTime.toString(),
    endTime: endTime.toString(),
    zoneHash: ZERO_BYTES32,
    salt: salt.toString(),
    conduitKey: OPENSEA_CONDUIT_KEY,
    counter: counter.toString(),
    totalOriginalConsiderationItems: 2,
  };

  await openSea.postSeaportListing(network, parameters, signature);
}

function resolveInstantFlipper(raw: unknown): InstantFlipperSettings {
  if (!isRecord(raw)) return { enabled: false };
  return {
    enabled: Boolean(raw.enabled),
    mode: raw.mode === "manual" ? "manual" : "auto",
    priceMode: raw.priceMode === "fixed" ? "fixed" : "floor_percent",
    floorMultiplier: numberOrUndefined(raw.floorMultiplier),
    fixedPriceEth: numberOrUndefined(raw.fixedPriceEth),
    minPriceEth: numberOrUndefined(raw.minPriceEth),
    maxPerWallet: raw.maxPerWallet == null ? undefined : Math.max(1, Math.floor(numberOrDefault(raw.maxPerWallet, 1))),
  };
}

function resolveFlipperPrice(settings: InstantFlipperSettings, floorPriceEth: number | null) {
  const fixedPrice = settings.fixedPriceEth;
  const multiplier = settings.floorMultiplier ?? 0.98;
  let price = settings.priceMode === "fixed" ? fixedPrice : floorPriceEth != null ? floorPriceEth * multiplier : fixedPrice;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (settings.minPriceEth != null) price = Math.max(price, settings.minPriceEth);
  return price;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOpenSeaPhase(phaseType: string) {
  const normalized = phaseType.toLowerCase();
  if (
    normalized === "allowlist" ||
    normalized === "gtd" ||
    normalized === "fcfs"
  )
    return normalized;
  return "public";
}

function rpcUrlsFor(network: "base" | "ethereum"): string[] {
  const prefix = network === "base" ? "BASE" : "ETH";
  return [
    env(`${prefix}_RPC_PRIMARY`),
    process.env[`${prefix}_RPC_BACKUP_1`],
    process.env[`${prefix}_RPC_BACKUP_2`],
  ].filter(Boolean) as string[];
}

async function sleepUntil(targetAt: Date) {
  // MINT_EARLY_BROADCAST_MS: broadcast this many ms BEFORE the target open time.
  // Ethereum block timestamps have ~15s tolerance — broadcasting 500–1000ms early
  // means our tx lands in the mempool before competing bots fire at T=0.
  // Safe default: 800ms. Set to 0 to disable.
  const earlyMs = numberEnv("MINT_EARLY_BROADCAST_MS", 800);

  // Wake up 20ms before (earlyMs + 20) and spin at 1ms intervals for precision.
  const fireAt = targetAt.getTime() - earlyMs;
  const wakeupMs = 20;
  const coarseWait = fireAt - Date.now() - wakeupMs;
  if (coarseWait > 0) {
    await delay(coarseWait);
  }

  while (Date.now() < fireAt) {
    await delay(Math.min(1, fireAt - Date.now()));
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// ── Bot Warfare ───────────────────────────────────────────────────────────

interface CompetitionResult {
  detected: boolean;
  competitorCount: number;
  recommendedMaxFeeGwei: number;
  spikeFactor: number;
}

async function detectBotCompetition(
  prisma: PrismaClient,
  mintTaskId: string,
  collectionSlug: string,
  chain: "BASE" | "ETHEREUM",
  currentGas: { baseFeePerGas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
): Promise<CompetitionResult> {
  const SPIKE_THRESHOLD = numberOrDefault(process.env["BOT_WARFARE_SPIKE_THRESHOLD"], 1.5);
  const BOOST_MULTIPLIER = numberOrDefault(process.env["BOT_WARFARE_BOOST_MULTIPLIER"], 1.2);

  let detected = false;
  let competitorCount = 0;
  let spikeFactor = 1;
  let recommendedMaxFeeGwei = Number(currentGas.maxFeePerGas / 1_000_000_000n);

  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const snapshots = await prisma.gasSnapshot.findMany({
      where: { network: chain, createdAt: { gte: fiveMinutesAgo } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (snapshots.length >= 3) {
      const avgBaseFee =
        snapshots.reduce((sum, s) => sum + BigInt(s.baseFeeWei), 0n) /
        BigInt(snapshots.length);

      if (avgBaseFee > 0n) {
        spikeFactor = Number(currentGas.baseFeePerGas * 100n / avgBaseFee) / 100;
        if (spikeFactor >= SPIKE_THRESHOLD) {
          detected = true;
          competitorCount = Math.max(1, Math.round((spikeFactor - 1) * 5));
          recommendedMaxFeeGwei = Math.ceil(
            Number(currentGas.maxFeePerGas / 1_000_000_000n) * BOOST_MULTIPLIER,
          );
        }
      }
    }
  } catch {
    // non-fatal — continue mint even if competition check fails
  }

  await prisma.botCompetitionLog
    .create({
      data: {
        mintTaskId,
        network: chain,
        collectionSlug,
        competitorCount,
        detectedGasWei: currentGas.baseFeePerGas.toString(),
        recommendedGasWei: (BigInt(recommendedMaxFeeGwei) * 1_000_000_000n).toString(),
        gasAdjusted: detected,
      },
    })
    .catch(() => undefined);

  return { detected, competitorCount, recommendedMaxFeeGwei, spikeFactor };
}

function applyCompetitionBoost(
  settings: GasSettings,
  competition: CompetitionResult,
): GasSettings {
  if (!competition.detected) return settings;
  // Boost both maxFee ceiling AND priorityFee floor.
  // maxFee alone isn't enough — during a gas war, priority fee determines
  // inclusion order. baseFee can spike before mempool priority catches up
  // (bots about to flood), so we preemptively raise priorityFeeGwei proportional
  // to the spike factor (capped at 3× to prevent runaway on extreme spikes).
  const priorityBoost = Math.min(competition.spikeFactor, 3);
  return {
    ...settings,
    maxFeeGwei: Math.max(settings.maxFeeGwei, competition.recommendedMaxFeeGwei),
    priorityFeeGwei: settings.priorityFeeGwei * priorityBoost,
  };
}

// ─────────────────────────────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );
  return results;
}

function numberEnv(name: string, fallback: number) {
  return numberOrDefault(process.env[name], fallback);
}

function bigintEnv(name: string, fallback: bigint) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isReceiptPending(error: unknown) {
  return /timeout|timed out|not found|could not find/i.test(rawErrorMessage(error));
}

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}


function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
