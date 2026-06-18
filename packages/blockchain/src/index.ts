import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isHex,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type TransactionRequest,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

export type ChainName = "base" | "ethereum" | "base-sepolia" | "ethereum-sepolia";

export interface BlockchainClientOptions {
  chainName: ChainName;
  rpcUrl: string;
}

export interface SendRawTransactionOptions extends BlockchainClientOptions {
  timeoutMs?: number;
}

export interface WaitForReceiptOptions {
  confirmations?: number;
  timeoutMs?: number;
}

const rawTxClientCache = new Map<string, ReturnType<typeof createPublicClient>>();

export type MintTransactionRequest = TransactionRequest & {
  account?: Address;
};

export const SEA_DROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";
export const OPENSEA_FEE_RECIPIENT = "0x0000a26b00c1F0DF003000390027140000fAa719";

const seaDropReadAbi = [
  {
    type: "function",
    name: "getAllowListData",
    stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "merkleRoot", type: "bytes32" },
          { name: "publicKeyURIs", type: "string[]" },
          { name: "allowListURI", type: "string" }
        ]
      }
    ]
  }
] as const;

export interface AllowListInfo {
  merkleRoot: string;
  allowListURI: string;
  addresses: string[];
  count: number;
}

/**
 * Fetch the allowlist for a SeaDrop collection.
 * 1. Calls getAllowListData on the SeaDrop contract to get the allowListURI.
 * 2. Fetches that URI (IPFS / HTTPS) to extract individual addresses.
 * Returns merkleRoot, URI, addresses array, and count.
 */
export async function getAllowListInfo(
  options: BlockchainClientOptions,
  nftContract: Address,
  seaDropAddress: Address = SEA_DROP_ADDRESS
): Promise<AllowListInfo> {
  const client = createMintPublicClient(options);

  const result = await client.readContract({
    address: seaDropAddress,
    abi: seaDropReadAbi,
    functionName: "getAllowListData",
    args: [getAddress(nftContract)]
  });

  const merkleRoot = result.merkleRoot as string;
  const allowListURI = result.allowListURI as string;

  if (!allowListURI) {
    return { merkleRoot, allowListURI: "", addresses: [], count: 0 };
  }

  // Resolve IPFS URIs to an HTTP gateway
  const fetchUrl = allowListURI.startsWith("ipfs://")
    ? allowListURI.replace("ipfs://", "https://ipfs.io/ipfs/")
    : allowListURI;

  let addresses: string[] = [];
  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const data = await res.json() as unknown;
      addresses = extractAllowListAddresses(data);
    }
  } catch {
    // URI fetch failed — return what we have from the contract
  }

  return { merkleRoot, allowListURI, addresses, count: addresses.length };
}

function extractAllowListAddresses(data: unknown): string[] {
  if (Array.isArray(data)) {
    // Flat array of address strings
    const flat = data
      .map((item) =>
        typeof item === "string" ? item :
        typeof item === "object" && item !== null ? String((item as Record<string, unknown>).address ?? (item as Record<string, unknown>).wallet ?? "") : ""
      )
      .filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
    if (flat.length > 0) return [...new Set(flat)];
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // Merkle tree format: { merkleRoot, entries: [{address, ...}] }
    for (const key of ["entries", "addresses", "wallets", "allowlist", "minters", "leaves"]) {
      if (Array.isArray(obj[key])) {
        const addrs = extractAllowListAddresses(obj[key]);
        if (addrs.length > 0) return addrs;
      }
    }
  }
  return [];
}

const seaDropAbi = [
  {
    type: "function",
    name: "mintPublic",
    stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "mintAllowList",
    stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
      {
        name: "mintParams",
        type: "tuple",
        components: [
          { name: "mintPrice", type: "uint256" },
          { name: "maxTotalMintableByWallet", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "dropStageIndex", type: "uint256" },
          { name: "maxTokenSupplyForStage", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "restrictFeeRecipients", type: "bool" }
        ]
      },
      { name: "proof", type: "bytes32[]" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "mintSigned",
    stateMutability: "payable",
    inputs: [
      { name: "nftContract", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "minterIfNotPayer", type: "address" },
      { name: "quantity", type: "uint256" },
      {
        name: "mintParams",
        type: "tuple",
        components: [
          { name: "mintPrice", type: "uint256" },
          { name: "maxTotalMintableByWallet", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "dropStageIndex", type: "uint256" },
          { name: "maxTokenSupplyForStage", type: "uint256" },
          { name: "feeBps", type: "uint256" },
          { name: "restrictFeeRecipients", type: "bool" }
        ]
      },
      { name: "salt", type: "uint256" },
      { name: "signature", type: "bytes" }
    ],
    outputs: []
  }
] as const;

export interface SeaDropMintParams {
  mintPriceWei: bigint | string;
  maxTotalMintableByWallet: bigint | string;
  startTime: bigint | string | number | Date;
  endTime: bigint | string | number | Date;
  dropStageIndex: bigint | string | number;
  maxTokenSupplyForStage: bigint | string;
  feeBps: bigint | string | number;
  restrictFeeRecipients: boolean;
}

export interface SeaDropPublicMintOptions {
  nftContract: Address;
  minter: Address;
  mintPriceWei: bigint | string;
  quantity?: number | bigint;
  feeRecipient?: Address;
  seaDropAddress?: Address;
}

export interface SeaDropAllowListMintOptions {
  nftContract: Address;
  minter: Address;
  mintParams: SeaDropMintParams;
  proof: Hex[];
  quantity?: number | bigint;
  feeRecipient?: Address;
  seaDropAddress?: Address;
}

export interface SeaDropSignedMintOptions {
  nftContract: Address;
  minter: Address;
  mintParams: SeaDropMintParams;
  salt: bigint | string | number;
  signature: Hex;
  quantity?: number | bigint;
  feeRecipient?: Address;
  seaDropAddress?: Address;
}

export function chainByName(chainName: ChainName): Chain {
  const chains: Record<ChainName, Chain> = {
    base,
    ethereum: mainnet,
    "base-sepolia": baseSepolia,
    "ethereum-sepolia": sepolia
  };
  return chains[chainName];
}

export function createSeaDropPublicMintPayload(options: SeaDropPublicMintOptions) {
  const quantity = BigInt(options.quantity ?? 1);
  if (quantity <= 0n) throw new Error("Mint quantity must be greater than zero.");

  const mintPriceWei = BigInt(options.mintPriceWei);
  const nftContract = getAddress(options.nftContract);
  const feeRecipient = getAddress(options.feeRecipient ?? OPENSEA_FEE_RECIPIENT);
  const minter = getAddress(options.minter);
  const to = getAddress(options.seaDropAddress ?? SEA_DROP_ADDRESS);

  if (nftContract === zeroAddress) {
    throw new Error("Collection contract address is missing. Rescan the collection before minting.");
  }
  if (minter === zeroAddress) throw new Error("Minter address is missing.");

  return {
    to,
    data: encodeFunctionData({
      abi: seaDropAbi,
      functionName: "mintPublic",
      args: [nftContract, feeRecipient, minter, quantity]
    }),
    value: mintPriceWei * quantity
  };
}

export function createSeaDropAllowListMintPayload(options: SeaDropAllowListMintOptions) {
  const base = normalizeSeaDropOptions(options);
  const proof = options.proof.map((item) => normalizeHex(item, "Allowlist proof"));
  const mintParams = normalizeMintParams(options.mintParams);

  return {
    to: base.to,
    data: encodeFunctionData({
      abi: seaDropAbi,
      functionName: "mintAllowList",
      args: [
        base.nftContract,
        base.feeRecipient,
        base.minter,
        base.quantity,
        mintParams,
        proof
      ]
    }),
    value: mintParams.mintPrice * base.quantity
  };
}

export function createSeaDropSignedMintPayload(options: SeaDropSignedMintOptions) {
  const base = normalizeSeaDropOptions(options);
  const signature = normalizeHex(options.signature, "Signed mint signature");
  const mintParams = normalizeMintParams(options.mintParams);

  return {
    to: base.to,
    data: encodeFunctionData({
      abi: seaDropAbi,
      functionName: "mintSigned",
      args: [
        base.nftContract,
        base.feeRecipient,
        base.minter,
        base.quantity,
        mintParams,
        BigInt(options.salt),
        signature
      ]
    }),
    value: mintParams.mintPrice * base.quantity
  };
}

export function createMintPublicClient(options: BlockchainClientOptions) {
  return createPublicClient({
    chain: chainByName(options.chainName),
    transport: http(options.rpcUrl, { retryCount: 2, retryDelay: 500 })
  });
}

function normalizeSeaDropOptions(options: {
  nftContract: Address;
  minter: Address;
  quantity?: number | bigint;
  feeRecipient?: Address;
  seaDropAddress?: Address;
}) {
  const quantity = BigInt(options.quantity ?? 1);
  if (quantity <= 0n) throw new Error("Mint quantity must be greater than zero.");

  const nftContract = getAddress(options.nftContract);
  const feeRecipient = getAddress(options.feeRecipient ?? OPENSEA_FEE_RECIPIENT);
  const minter = getAddress(options.minter);
  const to = getAddress(options.seaDropAddress ?? SEA_DROP_ADDRESS);

  if (nftContract === zeroAddress) {
    throw new Error("Collection contract address is missing. Rescan the collection before minting.");
  }
  if (minter === zeroAddress) throw new Error("Minter address is missing.");

  return { quantity, nftContract, feeRecipient, minter, to };
}

function normalizeMintParams(params: SeaDropMintParams) {
  return {
    mintPrice: BigInt(params.mintPriceWei),
    maxTotalMintableByWallet: BigInt(params.maxTotalMintableByWallet),
    startTime: toUnixSeconds(params.startTime),
    endTime: toUnixSeconds(params.endTime),
    dropStageIndex: BigInt(params.dropStageIndex),
    maxTokenSupplyForStage: BigInt(params.maxTokenSupplyForStage),
    feeBps: BigInt(params.feeBps),
    restrictFeeRecipients: params.restrictFeeRecipients
  };
}

function toUnixSeconds(value: bigint | string | number | Date) {
  if (value instanceof Date) return BigInt(Math.floor(value.getTime() / 1000));
  if (typeof value === "number") {
    return BigInt(value > 10_000_000_000 ? Math.floor(value / 1000) : value);
  }

  const raw = BigInt(value);
  return raw > 10_000_000_000n ? raw / 1000n : raw;
}

function normalizeHex(value: string, label: string): Hex {
  if (!isHex(value)) throw new Error(`${label} is not valid hex data.`);
  return value;
}

export async function getBalance(options: BlockchainClientOptions, address: Address): Promise<bigint> {
  return createMintPublicClient(options).getBalance({ address });
}

export async function getNonce(options: BlockchainClientOptions, address: Address): Promise<number> {
  return createMintPublicClient(options).getTransactionCount({ address });
}

export async function estimateMintGas(
  options: BlockchainClientOptions,
  request: MintTransactionRequest
): Promise<bigint> {
  return createMintPublicClient(options).estimateGas(request);
}

const GET_PUBLIC_DROP_ABI = [
  {
    type: "function",
    name: "getPublicDrop",
    stateMutability: "view",
    inputs: [{ name: "nftContract", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "mintPrice", type: "uint80" },
          { name: "startTime", type: "uint48" },
          { name: "endTime", type: "uint48" },
          { name: "maxTotalMintableByWallet", type: "uint16" },
          { name: "feeBps", type: "uint16" },
          { name: "restrictFeeRecipients", type: "bool" },
        ],
      },
    ],
  },
] as const;

/**
 * Fetches the on-chain SeaDrop public phase start time for an NFT contract.
 * Returns null if the contract does not implement getPublicDrop or the call fails.
 * Use this to verify/correct the OpenSea API startTime before scheduling.
 */
export async function fetchSeaDropPublicStartTime(
  options: BlockchainClientOptions,
  seaDropAddress: string,
  nftContract: string,
): Promise<Date | null> {
  try {
    const client = createMintPublicClient(options);
    const drop = await client.readContract({
      address: getAddress(seaDropAddress),
      abi: GET_PUBLIC_DROP_ABI,
      functionName: "getPublicDrop",
      args: [getAddress(nftContract)],
    });
    if (!drop.startTime) return null;
    return new Date(Number(drop.startTime) * 1000);
  } catch {
    return null;
  }
}

export async function simulateTx(options: BlockchainClientOptions, request: MintTransactionRequest) {
  const client = createMintPublicClient(options);
  await client.call({
    account: request.account,
    to: request.to,
    data: request.data,
    value: request.value
  });
  const gas = await client.estimateGas(request);
  return { ok: true as const, estimatedGas: gas };
}

export function walletClientFromPrivateKey(
  options: BlockchainClientOptions,
  privateKey: Hex
): WalletClient {
  assertMainnetTransactionsEnabled(options.chainName, "wallet client creation");
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: chainByName(options.chainName),
    transport: http(options.rpcUrl, { retryCount: 0 })
  });
}

export async function signTransaction(
  options: BlockchainClientOptions,
  privateKey: Hex,
  request: MintTransactionRequest
): Promise<Hex> {
  assertMainnetTransactionsEnabled(options.chainName, "transaction signing");
  const account = privateKeyToAccount(privateKey);
  return account.signTransaction({
    chainId: chainByName(options.chainName).id,
    to: request.to,
    data: request.data,
    value: request.value,
    gas: request.gas,
    nonce: request.nonce,
    maxFeePerGas: request.maxFeePerGas,
    maxPriorityFeePerGas: request.maxPriorityFeePerGas,
    type: "eip1559"
  });
}

export async function sendRawTransaction(options: SendRawTransactionOptions, serializedTransaction: Hex) {
  assertMainnetTransactionsEnabled(options.chainName, "transaction broadcast");
  const timeoutMs = "timeoutMs" in options && options.timeoutMs ? options.timeoutMs : 2_500;
  const cacheKey = `${options.chainName}:${options.rpcUrl}:${timeoutMs}`;
  let client = rawTxClientCache.get(cacheKey);
  if (!client) {
    client = createPublicClient({
      chain: chainByName(options.chainName),
      transport: http(options.rpcUrl, {
        retryCount: 0,
        timeout: timeoutMs
      })
    });
    rawTxClientCache.set(cacheKey, client);
  }
  return client.sendRawTransaction({ serializedTransaction });
}

function assertMainnetTransactionsEnabled(chainName: ChainName, action: string) {
  if (chainName !== "base" && chainName !== "ethereum") return;

  if (envFlag("MAINNET_TX_KILL_SWITCH") || envFlag("MAINNET_SIGNING_KILL_SWITCH")) {
    throw new Error(`Mainnet ${action} is blocked by the transaction kill switch.`);
  }

  if (!envFlag("MAINNET_SIGNING_ENABLED")) {
    throw new Error(
      `Mainnet ${action} is disabled. Set MAINNET_SIGNING_ENABLED=true only when you intentionally want live mainnet transactions.`,
    );
  }
}

function envFlag(name: string) {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? "");
}

export async function waitForReceipt(
  options: BlockchainClientOptions,
  hash: Hex,
  receiptOptions: WaitForReceiptOptions = {}
) {
  return createMintPublicClient(options).waitForTransactionReceipt({
    hash,
    confirmations: receiptOptions.confirmations ?? 1,
    timeout: receiptOptions.timeoutMs ?? 120_000
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Analyzer — detect type + suggest gas limit (no Etherscan key needed)
// ─────────────────────────────────────────────────────────────────────────────

export type ContractType = "SeaDrop" | "ERC721A" | "ERC721" | "ERC1155" | "Unknown";

export interface ContractAnalysis {
  contractType: ContractType;
  name: string;
  totalSupply: string;
  detectedFunctions: string[];
  gasLimit: {
    recommended: number;
    safe: number;
  };
}

// Function selectors → contract type mapping
const CONTRACT_SELECTORS: Record<string, { fn: string; type: ContractType }> = {
  "0x840e15d4": { fn: "getMintStats(address)",  type: "SeaDrop"  }, // SeaDrop-specific
  "0x6489fcad": { fn: "mintSeaDrop(...)",        type: "SeaDrop"  }, // SeaDrop-specific
  "0x2db11544": { fn: "mintERC2309(...)",         type: "ERC721A"  }, // ERC721A-specific
  "0xa0712d68": { fn: "mint(uint256)",            type: "ERC721"   },
  "0x1249c58b": { fn: "mint()",                  type: "ERC721"   },
  "0xd9b67a26": { fn: "ERC1155 interface check", type: "ERC1155"  },
};

// Safe gas limits per contract type
const GAS_LIMIT_MAP: Record<ContractType, { recommended: number; safe: number }> = {
  SeaDrop:  { recommended: 280_000, safe: 350_000 },
  ERC721A:  { recommended: 130_000, safe: 180_000 },
  ERC721:   { recommended: 180_000, safe: 230_000 },
  ERC1155:  { recommended: 100_000, safe: 150_000 },
  Unknown:  { recommended: 200_000, safe: 280_000 },
};

const NAME_ABI = [
  { type: "function", name: "name",        stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/**
 * Analyzes an NFT contract by probing function selectors via RPC.
 * No Etherscan API key required — uses existing ETH_RPC_PRIMARY from env.
 *
 * Returns detected contract type and recommended gas limits for minting.
 *
 * @example
 * const analysis = await analyzeContract(rpcOptions, "0x9dc39b51...");
 * console.log(analysis.contractType);   // "SeaDrop"
 * console.log(analysis.gasLimit.safe);  // 350000
 */
export async function analyzeContract(
  options: BlockchainClientOptions,
  contractAddress: string
): Promise<ContractAnalysis> {
  const client  = createMintPublicClient(options);
  const address = getAddress(contractAddress);

  let contractType: ContractType = "Unknown";
  const detectedFunctions: string[] = [];

  // Probe each selector — revert = function exists, call failed = not present
  for (const [selector, meta] of Object.entries(CONTRACT_SELECTORS)) {
    try {
      await client.call({ to: address, data: selector as `0x${string}` });
      detectedFunctions.push(meta.fn);
      contractType = meta.type;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      // "execution reverted" means function IS present but rejected wrong args
      if (msg.includes("execution reverted") || msg.includes("revert")) {
        detectedFunctions.push(meta.fn);
        contractType = meta.type;
      }
      // Any other error (e.g. "function selector not found") = not present
    }
  }

  // SeaDrop takes priority if detected (most specific type)
  if (detectedFunctions.some(f => f.includes("getMintStats") || f.includes("mintSeaDrop"))) {
    contractType = "SeaDrop";
  }

  // Fetch human-readable info
  let name         = "Unknown";
  let totalSupply  = "Unknown";

  try {
    const contract = { address, abi: NAME_ABI };
    name        = await client.readContract({ ...contract, functionName: "name" }) as string;
    totalSupply = String(await client.readContract({ ...contract, functionName: "totalSupply" }));
  } catch {
    // Non-critical — continue without metadata
  }

  return {
    contractType,
    name,
    totalSupply,
    detectedFunctions,
    gasLimit: GAS_LIMIT_MAP[contractType],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ABI Fetcher — no Etherscan API key needed
// Sources: Sourcify → Etherscan public (rate-limited) → selector fallback
// ─────────────────────────────────────────────────────────────────────────────

export interface AbiResult {
  abi:    unknown[];
  source: "sourcify" | "etherscan-key" | "etherscan-public" | "selector-fallback";
  verified: boolean;
}

/**
 * Fetch contract ABI — tries sources in priority order:
 *   1. Sourcify          (free, no key)
 *   2. Etherscan + key   (fast, reliable — uses ETHERSCAN_API_KEY from env)
 *   3. Etherscan public  (no key, rate-limited fallback)
 *   4. Selector fallback (offline, known signatures)
 */
export async function fetchContractAbi(
  contractAddress: string,
  chainId: number = 1   // 1 = Ethereum mainnet, 8453 = Base
): Promise<AbiResult> {
  const address    = getAddress(contractAddress);
  const etherscanKey = process.env["ETHERSCAN_API_KEY"] ?? "";

  // ── 1. Sourcify ───────────────────────────────────────────────────────────
  try {
    const url = `https://sourcify.dev/server/v1/files/any/${chainId}/${address}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const data  = await res.json() as { files?: { name: string; content: string }[] };
      const entry = data.files?.find(f => f.name.endsWith(".json") && !f.name.includes("metadata"));
      if (entry) {
        const parsed = JSON.parse(entry.content) as { abi?: unknown[] };
        if (Array.isArray(parsed.abi) && parsed.abi.length > 0) {
          return { abi: parsed.abi, source: "sourcify", verified: true };
        }
      }
    }
  } catch { /* try next source */ }

  // ── 2. Etherscan with API key (fast, no rate limit) ───────────────────────
  if (etherscanKey && etherscanKey !== "replace_me") {
    try {
      const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${etherscanKey}`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const data = await res.json() as { status: string; result: string };
        if (data.status === "1") {
          const abi = JSON.parse(data.result) as unknown[];
          return { abi, source: "etherscan-key", verified: true };
        }
      }
    } catch { /* try next source */ }
  }

  // ── 3. Etherscan public (no key, rate-limited to ~1 req/5s) ──────────────
  try {
    const url  = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const data = await res.json() as { status: string; result: string };
      if (data.status === "1") {
        const abi = JSON.parse(data.result) as unknown[];
        return { abi, source: "etherscan-public", verified: true };
      }
    }
  } catch { /* try next source */ }

  // ── 3. Selector fallback — minimal ABI from known signatures ─────────────
  // Covers SeaDrop + common ERC721 functions without any external API
  const fallbackAbi = [
    { type: "function", name: "name",         stateMutability: "view",    inputs: [],                                         outputs: [{ type: "string"  }] },
    { type: "function", name: "symbol",       stateMutability: "view",    inputs: [],                                         outputs: [{ type: "string"  }] },
    { type: "function", name: "totalSupply",  stateMutability: "view",    inputs: [],                                         outputs: [{ type: "uint256" }] },
    { type: "function", name: "maxSupply",    stateMutability: "view",    inputs: [],                                         outputs: [{ type: "uint256" }] },
    { type: "function", name: "ownerOf",      stateMutability: "view",    inputs: [{ name: "tokenId", type: "uint256" }],     outputs: [{ type: "address" }] },
    { type: "function", name: "balanceOf",    stateMutability: "view",    inputs: [{ name: "owner",   type: "address" }],     outputs: [{ type: "uint256" }] },
    { type: "function", name: "tokenURI",     stateMutability: "view",    inputs: [{ name: "tokenId", type: "uint256" }],     outputs: [{ type: "string"  }] },
    { type: "function", name: "getMintStats", stateMutability: "view",    inputs: [{ name: "minter",  type: "address" }],     outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
    { type: "function", name: "mint",         stateMutability: "payable", inputs: [{ name: "quantity", type: "uint256" }],    outputs: [] },
    { type: "function", name: "mintSeaDrop",  stateMutability: "nonpayable", inputs: [{ name: "minter", type: "address" }, { name: "quantity", type: "uint256" }], outputs: [] },
  ];

  return { abi: fallbackAbi, source: "selector-fallback", verified: false };
}
