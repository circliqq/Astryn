/**
 * OpenSea Collection Eligibility Checker — SeaDrop Mint Stages
 * ============================================================
 * Python `check-eligibility` එක bot එකේ style එකට port කරපු version එක.
 *
 * මොකද කරන්නේ:
 *   1. හැම private key එකකටම OpenSea SIWE (Sign-In With Ethereum) auth එක කරනවා
 *   2. DropEligibilityQuery GraphQL එකෙන් eligible mint stages ටික ගන්නවා
 *   3. PUBLIC_SALE නැති eligible stages ටික වෙන වෙනම stage files වලට save කරනවා
 *
 * Usage:
 *   node check-eligibility.mjs <collection-slug>
 *   node check-eligibility.mjs the-beaks            # slug එක arg විදිහට
 *   COLLECTION_SLUG=the-beaks node check-eligibility.mjs   # env විදිහට
 *
 * Keys:
 *   - privkeys.txt තිබුණොත් ඒකෙන් (line එකකට key එක) bulk check කරනවා
 *   - නැත්නම් CONFIG.PRIVATE_KEY / PRIVATE_KEY env එක single key විදිහට ගන්නවා
 *
 * ⚠️  OpenSea එක Cloudflare + TLS-fingerprint protection use කරනවා. Original
 *     Python එක curl_cffi (chrome impersonation) use කළේ ඒ නිසා. Node native
 *     fetch එකෙන් 403 එනවා නම්, OPENSEA_API_KEY env එක set කරන්න (.env එකේ
 *     දැනටමත් තියෙනවා) — ඒක request වලට header විදිහට යනවා.
 */

import { ethers } from "ethers";
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

// require() shim for ESM (undici lazy load inside buildProxyAgent)
const require = createRequire(import.meta.url);

// ═══════════════════════════════════════════
// CONFIG — මේවා විතරයි wenas කරන්න
// ═══════════════════════════════════════════
const CONFIG = {
  CHAIN_ID:           1,                       // Ethereum mainnet
  COLLECTION_SLUG:    "",                       // default slug (arg/env එකෙන් override වෙනවා)
  PRIVKEYS_FILE:      "privkeys.txt",           // bulk keys file (optional)
  PROXY_FILE:         "proxy.txt",              // ip:port:user:pass (optional)
  PRIVATE_KEY:        "",                        // single key fallback
  THREADS:            3,                         // concurrent wallets (rate-limit safe)
  DELAY_MS:           1500,                      // wallet එකකට පස්සේ delay
  RETRIES:            3,                         // retry count per wallet
  OPENSEA_API_KEY:    process.env.OPENSEA_API_KEY || "",
  OUT_DIR:            "out",
};

const STATEMENT =
  "Click to sign in and accept the OpenSea Terms of Service " +
  "(https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).";

// Browser-ish headers — Cloudflare එක ටිකක් softකරන්න
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function nowUtcIsoMs() {
  // ISO 8601 with millisecond precision, e.g. 2026-06-16T12:34:56.789Z (OpenSea expects this)
  return new Date().toISOString();
}

function tsForFilename() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-");
}

function siweMessageText({ domain, address, statement, uri, version, chainId, nonce, issuedAt }) {
  return (
    `${domain} wants you to sign in with your account:\n` +
    `${address}\n\n` +
    `${statement}\n\n` +
    `URI: ${uri}\n` +
    `Version: ${version}\n` +
    `Chain ID: ${chainId}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`
  );
}

const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Minimal cookie-jar session (native fetch + manual Set-Cookie replay) ───
class Session {
  constructor(proxyAgent) {
    this.cookies = new Map();
    this.proxyAgent = proxyAgent; // undici ProxyAgent | undefined
    this.baseHeaders = {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": UA,
      origin: "https://opensea.io",
      referer: "https://opensea.io/",
    };
    if (CONFIG.OPENSEA_API_KEY) this.baseHeaders["x-api-key"] = CONFIG.OPENSEA_API_KEY;
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  storeCookies(res) {
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async request(url, { method = "GET", headers = {}, body } = {}) {
    const opts = {
      method,
      headers: { ...this.baseHeaders, ...headers },
      body,
    };
    if (this.cookies.size) opts.headers.cookie = this.cookieHeader();
    if (this.proxyAgent) opts.dispatcher = this.proxyAgent;
    const res = await fetch(url, opts);
    this.storeCookies(res);
    return res;
  }
}

// ═══════════════════════════════════════════
// STAGE PARSING — PUBLIC_SALE skip කරනවා
// ═══════════════════════════════════════════
function parseStages(drop) {
  const stages = drop?.stages || [];
  const out = [];
  for (const s of stages) {
    if (!s?.isEligible) continue;
    const stageType = s.stageType;
    if (stageType === "PUBLIC_SALE") continue;

    const stageIdx = s.stageIndex;
    let stageName;
    if (stageType) {
      stageName = stageIdx != null ? `${stageType}#${stageIdx}` : stageType;
    } else {
      stageName = stageIdx != null ? `Stage${stageIdx}` : "Unknown";
    }
    out.push({ stage: stageName, max_mint: s.eligibleMaxTotalMintableByWallet ?? 0 });
  }
  return out;
}

const DROP_ELIGIBILITY_QUERY = `query DropEligibilityQuery($collectionSlug: String!, $address: Address!) {
  dropBySlug(slug: $collectionSlug) {
    __typename
    ... on Erc721SeaDropV1 { minterQuantityMinted(minter: $address) __typename }
    stages {
      stageType
      stageIndex
      isEligible
      maxTotalMintableByWallet
      eligibleMaxTotalMintableByWallet
      eligiblePrice {
        ...TokenPrice ...UsdPrice usd
        token { unit symbol contractAddress chain { identifier __typename } __typename }
        __typename
      }
      ... on Erc1155SeaDropV2Stage {
        fromTokenId toTokenId
        maxTotalMintableByWalletPerToken
        eligibleMaxTotalMintableByWalletPerToken
        __typename
      }
      __typename
    }
  }
}
fragment TokenPrice on Price { usd token { unit symbol contractAddress chain { identifier __typename } __typename } __typename }
fragment UsdPrice on Price { usd token { contractAddress unit ...currencyIdentifier __typename } __typename }
fragment currencyIdentifier on ContractIdentifier { contractAddress chain { identifier __typename } __typename }`;

// ═══════════════════════════════════════════
// CHECK ONE KEY (with retries)
// ═══════════════════════════════════════════
async function checkOneKey(privKey, collectionSlug, proxyAgent) {
  const wallet = new ethers.Wallet(privKey);
  const address = wallet.address;

  let lastErr;
  for (let attempt = 1; attempt <= CONFIG.RETRIES; attempt++) {
    try {
      const session = new Session(proxyAgent);

      // 1) warm-up
      await session.request("https://opensea.io");

      // 2) nonce
      const rNonce = await session.request("https://opensea.io/__api/auth/siwe/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      });
      if (RETRYABLE.has(rNonce.status)) throw new Error(`Nonce request failed: ${rNonce.status}`);
      let nonce;
      try {
        nonce = (await rNonce.json())?.nonce;
      } catch {
        throw new Error(`Nonce parse error: ${rNonce.status}`);
      }
      if (!nonce) throw new Error("Nonce empty");

      // 3) build + sign SIWE message
      const issuedAt = nowUtcIsoMs();
      const siweDict = {
        address,
        chainId: String(CONFIG.CHAIN_ID),
        domain: "opensea.io",
        issuedAt,
        nonce,
        statement: STATEMENT,
        uri: "https://opensea.io/",
        version: "1",
      };
      const msg = siweMessageText({
        domain: "opensea.io",
        address,
        statement: STATEMENT,
        uri: "https://opensea.io/",
        version: "1",
        chainId: CONFIG.CHAIN_ID,
        nonce,
        issuedAt,
      });
      let signature = await wallet.signMessage(msg);
      if (!signature.startsWith("0x")) signature = "0x" + signature;

      // 4) verify
      const rVerify = await session.request("https://opensea.io/__api/auth/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainArch: "EVM", message: siweDict, signature }),
      });
      if (rVerify.status !== 200) {
        if (RETRYABLE.has(rVerify.status)) throw new Error(`Verify request failed: ${rVerify.status}`);
        return { address, result: { __error: `Verify: ${rVerify.status}` } };
      }

      // 5) eligibility GraphQL
      session.cookies.set("connected-account-server-hint", address.toLowerCase());
      const rCheck = await session.request("https://gql.opensea.io/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationName: "DropEligibilityQuery",
          query: DROP_ELIGIBILITY_QUERY,
          variables: { address, collectionSlug },
        }),
      });
      if (RETRYABLE.has(rCheck.status)) throw new Error(`GQL request failed: ${rCheck.status}`);
      let j;
      try {
        j = await rCheck.json();
      } catch {
        throw new Error(`GQL parse error: ${rCheck.status}`);
      }
      if (j.errors) {
        const errStr = JSON.stringify(j.errors).toLowerCase();
        if (errStr.includes("rate limit") || errStr.includes("429")) throw new Error("GQL rate limit error");
        return { address, result: { __error: "GQL errors" } };
      }
      const drop = j?.data?.dropBySlug;
      if (!drop) return { address, result: { __error: "No drop data" } };

      return { address, result: parseStages(drop) };
    } catch (err) {
      lastErr = err;
      if (attempt < CONFIG.RETRIES) await sleep(3000);
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════
// PUBLIC API — bot එකෙන් import කරන්න පුළුවන්
// ═══════════════════════════════════════════
/**
 * @param {string} privKey  single private key
 * @param {string} collectionSlug
 * @returns {Promise<Array<{stage,max_mint}>>}  eligible (non-public) stages
 */
export async function checkEligibility(privKey, collectionSlug, { proxyAgent } = {}) {
  const { result } = await checkOneKey(privKey, collectionSlug, proxyAgent);
  if (result && !Array.isArray(result) && result.__error) {
    throw new Error(result.__error);
  }
  return Array.isArray(result) ? result : [];
}

/** true/false — දුන්න wallet එක (public නෙවෙයි) කිසියම් stage එකකට eligible ද? */
export async function isEligible(privKey, collectionSlug, opts = {}) {
  const stages = await checkEligibility(privKey, collectionSlug, opts);
  return stages.length > 0;
}

// ═══════════════════════════════════════════
// CLI — bulk runner (privkeys.txt) with concurrency
// ═══════════════════════════════════════════
function loadLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function buildProxyAgent() {
  const proxies = loadLines(CONFIG.PROXY_FILE);
  if (!proxies.length) return undefined;
  // ip:port:user:pass
  const [ip, port, user, pass] = proxies[Math.floor(Math.random() * proxies.length)].split(":");
  try {
    // undici ships with Node 18+ — ProxyAgent for fetch dispatcher
    const { ProxyAgent } = require("undici");
    const auth = user && pass ? `${user}:${pass}@` : "";
    return new ProxyAgent(`http://${auth}${ip}:${port}`);
  } catch {
    console.log("⚠️  undici ProxyAgent load කරගන්න බැරි උනා — proxy නැතුව යනවා.");
    return undefined;
  }
}

async function runCli() {
  const slug = process.argv[2] || process.env.COLLECTION_SLUG || CONFIG.COLLECTION_SLUG;
  if (!slug) {
    console.error("❌ Collection slug එකක් දෙන්න:  node check-eligibility.mjs <collection-slug>");
    process.exit(1);
  }

  // keys: privkeys.txt > CONFIG/env single key
  let keys = loadLines(CONFIG.PRIVKEYS_FILE);
  if (!keys.length) {
    const single = CONFIG.PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (single) keys = [single];
  }
  if (!keys.length) {
    console.error(`❌ Keys නෑ — ${CONFIG.PRIVKEYS_FILE} එකක් දාන්න, නැත්නම් PRIVATE_KEY env එක set කරන්න.`);
    process.exit(1);
  }

  console.log("═".repeat(60));
  console.log(`  OpenSea Eligibility Check — slug: ${slug}`);
  console.log(`  Wallets: ${keys.length} | Threads: ${CONFIG.THREADS}`);
  console.log("═".repeat(60));

  const ts = tsForFilename();
  const outDir = CONFIG.OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const stagesDir = join(outDir, `stages_${slug}_${ts}`);
  mkdirSync(stagesDir, { recursive: true });

  const resultMap = {};
  const total = keys.length;
  let idx = 0;
  let counter = 0;
  const proxyAgent = buildProxyAgent();

  async function workerLoop() {
    while (idx < keys.length) {
      const myNum = ++counter;
      const key = keys[idx++];
      let address = "????";
      try {
        address = new ethers.Wallet(key).address;
        const stages = await checkEligibility(key, slug, { proxyAgent });
        resultMap[address] = stages;
        const tag = `[${myNum}/${total}]`.padEnd(12);
        if (stages.length) {
          for (const s of stages) {
            appendFileSync(join(stagesDir, `${s.stage}.txt`), `${address}:${key}\n`);
          }
          const str = stages.map((s) => `${s.stage}(${s.max_mint})`).join(", ");
          console.log(`✅ ${tag}${address} | ${str}`);
        } else {
          console.log(`✅ ${tag}${address} | Not eligible`);
        }
      } catch (err) {
        const tag = `[${myNum}/${total}]`.padEnd(12);
        console.log(`❌ ${tag}${address} | ${err.message || err}`);
        resultMap[address] = { __error: String(err.message || err) };
      }
      await sleep(CONFIG.DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONFIG.THREADS }, workerLoop));

  // ── save JSON + CSV ──
  const jsonPath = join(outDir, `eligibility_${slug}_${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify(resultMap, null, 2));

  const csvPath = join(outDir, `eligibility_${slug}_${ts}.csv`);
  const rows = ["Address,Eligible Stages"];
  for (const [addr, stages] of Object.entries(resultMap)) {
    let cell;
    if (Array.isArray(stages) && stages.length) {
      cell = stages.map((s) => `${s.stage}(${s.max_mint})`).join(" / ");
    } else if (Array.isArray(stages)) {
      cell = "Not eligible";
    } else {
      cell = "ERROR";
    }
    rows.push(`${addr},"${cell}"`);
  }
  writeFileSync(csvPath, rows.join("\n"));

  // ── stats ──
  const checked = Object.keys(resultMap).length;
  const eligible = Object.values(resultMap).filter((s) => Array.isArray(s) && s.length).length;
  const notEligible = Object.values(resultMap).filter((s) => Array.isArray(s) && !s.length).length;
  const errors = Object.values(resultMap).filter((s) => !Array.isArray(s)).length;

  console.log("\n" + "═".repeat(60));
  console.log("STATISTICS");
  console.log("═".repeat(60));
  console.log(`Checked      : ${checked}`);
  console.log(`Eligible     : ${eligible}`);
  console.log(`Not eligible : ${notEligible}`);
  console.log(`Errors       : ${errors}`);
  console.log(`\nSaved JSON   : ${jsonPath}`);
  console.log(`Saved CSV    : ${csvPath}`);
  console.log(`Stages dir   : ${stagesDir}`);
  console.log("═".repeat(60));
}

// Run CLI only when executed directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((e) => {
    console.error("❌ Fatal:", e.message || e);
    process.exit(1);
  });
}
