/**
 * Allowlist Checker — Standalone Tool
 * =====================================
 * Usage:
 *   node check.mjs <contractAddress> [chain] [opensea_slug]
 *
 * Examples:
 *   node check.mjs 0xaa83d0d73bc8db70523e16dad047962c57075e0
 *   node check.mjs 0xaa83d0d73bc8db70523e16dad047962c57075e0 ethereum heyshellmates
 *   node check.mjs 0xSomeBase... base some-collection-slug
 *
 * Returns FCFS + GTD eligible address counts from:
 *   1. SeaDrop contract (getAllowListData → allowListURI)
 *   2. OpenSea API (if OPENSEA_API_KEY env var is set or slug is provided)
 */

import { createPublicClient, http, getAddress } from "viem";
import { mainnet, base } from "viem/chains";

// ── Config ────────────────────────────────────────────────────────────────────

const SEADROP_V1 = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";

const PUBLIC_RPC = {
  ethereum: [
    "https://eth.drpc.org",
    "https://cloudflare-eth.com",
    "https://rpc.ankr.com/eth",
  ],
  base: [
    "https://base.drpc.org",
    "https://mainnet.base.org",
    "https://rpc.ankr.com/base",
  ],
};

const SEADROP_ABI = [
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
          { name: "merkleRoot",     type: "bytes32"  },
          { name: "publicKeyURIs", type: "string[]" },
          { name: "allowListURI",  type: "string"   },
        ],
      },
    ],
  },
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
          { name: "mintPrice",          type: "uint80"  },
          { name: "startTime",          type: "uint48"  },
          { name: "endTime",            type: "uint48"  },
          { name: "maxTotalMintableByWallet", type: "uint16" },
          { name: "feeBps",             type: "uint16"  },
          { name: "restrictFeeRecipients", type: "bool" },
        ],
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }
function sep()     { console.log("  " + "─".repeat(52)); }

function ipfsToHttp(uri) {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    return [
      `https://ipfs.io/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
    ];
  }
  return [uri];
}

function extractAddresses(data) {
  const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

  // Flat address array
  if (Array.isArray(data)) {
    const flat = data
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" && item !== null
          ? String(item.address ?? item.wallet ?? item.wallet_address ?? "")
          : ""
      )
      .filter((a) => ADDRESS_RE.test(a));
    if (flat.length > 0) return [...new Set(flat.map((a) => a.toLowerCase()))];
  }

  if (typeof data === "object" && data !== null) {
    // Merkle tree with leaves: [{address, ...}]
    for (const key of ["leaves", "entries", "addresses", "wallets", "allowlist", "minters", "eligible_addresses"]) {
      if (Array.isArray(data[key])) {
        const addrs = extractAddresses(data[key]);
        if (addrs.length > 0) return addrs;
      }
    }
    // Merkle tree format: { merkleRoot, values: [[address, ...], ...] }
    if (Array.isArray(data.values)) {
      const addrs = data.values
        .map((v) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v : ""))
        .filter((a) => ADDRESS_RE.test(a));
      if (addrs.length > 0) return [...new Set(addrs.map((a) => a.toLowerCase()))];
    }
    // OpenZeppelin MerkleTree format: { format, tree, values: [{value:[address,...]}] }
    if (data.format && Array.isArray(data.values)) {
      const addrs = data.values
        .flatMap((entry) => (Array.isArray(entry.value) ? entry.value : []))
        .filter((a) => ADDRESS_RE.test(a));
      if (addrs.length > 0) return [...new Set(addrs.map((a) => a.toLowerCase()))];
    }
  }

  return [];
}

async function fetchWithTimeout(url, opts = {}, ms = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllowListURI(uri) {
  const urls = ipfsToHttp(uri);
  if (!urls) return null;

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const text = await res.text();
      try {
        return { url, data: JSON.parse(text) };
      } catch {
        // Not JSON — maybe a plain address list
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const addrs = lines.filter((l) => /^0x[a-fA-F0-9]{40}$/.test(l));
        if (addrs.length > 0) return { url, data: addrs };
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function tryRpc(chainName, rpcs, contractAddress) {
  const chain = chainName === "base" ? base : mainnet;
  const address = getAddress(contractAddress);
  const seaDrop = getAddress(SEADROP_V1);

  for (const rpcUrl of rpcs) {
    try {
      const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 8_000 }) });
      const result = await client.readContract({
        address: seaDrop,
        abi: SEADROP_ABI,
        functionName: "getAllowListData",
        args: [address],
      });
      return result;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchOpenSeaAllowlist(slug, chain, apiKey) {
  if (!slug && !apiKey) return null;
  const headers = apiKey ? { "x-api-key": apiKey, accept: "application/json" } : { accept: "application/json" };
  const network = chain === "base" ? "base" : "ethereum";

  const endpoints = slug
    ? [
        `https://api.opensea.io/api/v2/drops/${slug}/allowlist?limit=10000`,
        `https://api.opensea.io/api/v2/drops/${slug}/allowlist`,
      ]
    : [];

  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      const addrs = extractAddresses(data);
      if (addrs.length > 0) return { source: "opensea-api", addresses: addrs };
    } catch {
      continue;
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const contractArg  = args[0];
  const chainArg     = (args[1] ?? "ethereum").toLowerCase();
  const slugArg      = args[2] ?? null;
  const apiKey       = process.env.OPENSEA_API_KEY ?? null;

  console.log();
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║         NFT Allowlist Eligibility Checker            ║");
  console.log("  ║      FCFS / GTD eligible address count tool          ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log();

  if (!contractArg || !/^0x[a-fA-F0-9]{40}$/.test(contractArg)) {
    console.log("  Usage: node check.mjs <contractAddress> [chain] [opensea_slug]");
    console.log("  Chain: ethereum (default) | base");
    console.log();
    console.log("  Example:");
    console.log("    node check.mjs 0xaa83d0d73bc8db70523e16dad047962c57075e0 ethereum heyshellmates");
    console.log();
    process.exit(1);
  }

  if (chainArg !== "ethereum" && chainArg !== "base") {
    err(`Unknown chain "${chainArg}". Use "ethereum" or "base".`);
    process.exit(1);
  }

  log(`Contract : ${contractArg}`);
  log(`Chain    : ${chainArg}`);
  if (slugArg) log(`Slug     : ${slugArg}`);
  if (apiKey)  log(`OpenSea  : API key detected ✓`);
  console.log();

  const results = {
    contract: contractArg,
    chain: chainArg,
    merkleRoot: null,
    allowListURI: null,
    fcfsCount: null,
    gtdCount: null,
    totalEligible: null,
    addresses: [],
    source: "unavailable",
    notes: [],
  };

  // ── Step 1: SeaDrop contract call ─────────────────────────────────────────
  sep();
  log("Step 1 — Reading SeaDrop contract (getAllowListData)...");

  const rpcs = PUBLIC_RPC[chainArg];
  const contractData = await tryRpc(chainArg, rpcs, contractArg);

  if (!contractData) {
    warn("Could not read from SeaDrop contract (RPC failed or contract not SeaDrop v1).");
    results.notes.push("Contract call failed — may not be a SeaDrop v1 collection.");
  } else {
    results.merkleRoot = contractData.merkleRoot;
    results.allowListURI = contractData.allowListURI;

    if (!contractData.merkleRoot || contractData.merkleRoot === "0x" + "0".repeat(64)) {
      warn("Merkle root is empty — no allowlist is set on-chain for this contract.");
      results.notes.push("No on-chain allowlist (merkle root is zero).");
    } else {
      ok(`Merkle root  : ${contractData.merkleRoot.slice(0, 18)}...`);
      ok(`AllowList URI: ${contractData.allowListURI || "(none)"}`);
    }
  }

  // ── Step 2: Fetch allowListURI ────────────────────────────────────────────
  let addresses = [];

  if (results.allowListURI) {
    sep();
    log("Step 2 — Fetching allowlist from URI...");

    const fetched = await fetchAllowListURI(results.allowListURI);
    if (fetched) {
      addresses = extractAddresses(fetched.data);
      if (addresses.length > 0) {
        ok(`Fetched ${addresses.length.toLocaleString()} addresses from URI`);
        ok(`Source: ${fetched.url}`);
        results.source = "contract+uri";
      } else {
        warn("URI fetched but could not extract addresses (unknown format).");
        results.notes.push(`Raw URI response available at: ${fetched.url}`);
      }
    } else {
      warn("Could not fetch allowListURI (IPFS timeout / private endpoint).");
      results.notes.push("AllowListURI is likely a private OpenSea server — address list is off-chain only.");
    }
  } else {
    log("Step 2 — No public allowListURI on contract, skipping.");
  }

  // ── Step 3: OpenSea API fallback ──────────────────────────────────────────
  if (addresses.length === 0 && (slugArg || apiKey)) {
    sep();
    log("Step 3 — Trying OpenSea API allowlist endpoint...");

    const osResult = await fetchOpenSeaAllowlist(slugArg, chainArg, apiKey);
    if (osResult) {
      addresses = osResult.addresses;
      ok(`OpenSea returned ${addresses.length.toLocaleString()} eligible addresses`);
      results.source = "opensea-api";
    } else {
      warn("OpenSea allowlist endpoint returned no data.");
      if (!apiKey) results.notes.push("Set OPENSEA_API_KEY env var for better OpenSea access.");
    }
  }

  // ── Step 4: Build result ──────────────────────────────────────────────────
  // Note: On-chain, FCFS and GTD share the same allowlist (both are SeaDrop
  // "allowlist" phase variants — same Merkle root, different time windows).
  // So the eligible count is the same for both.
  results.addresses = addresses;
  results.totalEligible = addresses.length;
  results.fcfsCount = addresses.length;  // same list — FCFS is a time-window on the allowlist
  results.gtdCount = addresses.length;   // same list — GTD gets priority window

  // ── Output ────────────────────────────────────────────────────────────────
  sep();
  console.log();
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │                     RESULTS                         │");
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log();

  if (results.totalEligible > 0) {
    console.log(`  📋 Total eligible addresses : ${results.totalEligible.toLocaleString()}`);
    console.log(`  🥇 GTD  eligible count      : ${results.gtdCount.toLocaleString()} (same list, priority window)`);
    console.log(`  🔓 FCFS eligible count      : ${results.fcfsCount.toLocaleString()} (same list, open window)`);
    console.log(`  📌 Data source              : ${results.source}`);
    console.log();

    if (results.addresses.length > 0) {
      console.log(`  First 5 addresses:`);
      results.addresses.slice(0, 5).forEach((a) => console.log(`    ${a}`));
      if (results.addresses.length > 5) {
        console.log(`    ... and ${(results.addresses.length - 5).toLocaleString()} more`);
      }
    }
  } else {
    console.log("  📋 Eligible address count   : Unknown");
    console.log(`  📌 Data source              : ${results.source}`);
    console.log();
    if (results.merkleRoot && results.merkleRoot !== "0x" + "0".repeat(64)) {
      console.log("  ℹ️  Merkle root exists on-chain but the full address list");
      console.log("     is stored on OpenSea's private servers.");
      console.log("     → Provide the OpenSea slug + API key for best results.");
      console.log(`     → Or fetch manually: ${results.allowListURI ?? "(no URI)"}`);
    } else {
      console.log("  ℹ️  No allowlist found on this contract.");
      console.log("     This may be a public mint or a non-SeaDrop collection.");
    }
  }

  if (results.merkleRoot) {
    console.log();
    console.log(`  🔑 Merkle root: ${results.merkleRoot}`);
  }

  if (results.notes.length > 0) {
    console.log();
    console.log("  Notes:");
    results.notes.forEach((n) => console.log(`    • ${n}`));
  }

  console.log();
  sep();
  console.log();
}

main().catch((e) => {
  console.error("  Fatal error:", e.message);
  process.exit(1);
});
