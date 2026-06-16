/**
 * NFT Mint Bot — SeaDrop + Contract Analyzer
 * ============================================
 * Usage: node mint-bot.mjs
 */

import { ethers } from "ethers";
import { checkEligibility } from "./check-eligibility.mjs";

// ═══════════════════════════════════════════
// CONFIG — මේවා විතරයි wenas කරන්න
// ═══════════════════════════════════════════
const CONFIG = {
  RPC_URL:       "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",  // ← ඔයාගේ key
  PRIVATE_KEY:   "YOUR_PRIVATE_KEY",                                // ← ඔයාගේ key
  NFT_CONTRACT:  "0x9dc39b51782d13e3d6a350553107089eacc0b336",
  SEADROP:       "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5",
  FEE_RECIPIENT: "0x0000a26b00c1F0DF003000390027140000fAa759",
  MINT_PRICE:    "0.03",
  MINT_TIME_UTC: new Date("2026-05-26T17:15:00.000Z"), // FCFS: 10:45 PM GMT+5:30
  PRIORITY_GWEI: "150",
  MAX_FEE_GWEI:  "250",

  // ── Eligibility gate (allowlist/presale stages) ──
  CHECK_ELIGIBILITY: false,        // true නම් mint කරන්න කලින් OpenSea eligibility check කරනවා
  COLLECTION_SLUG:   "",           // OpenSea collection slug (CHECK_ELIGIBILITY true නම් ඕන)
  REQUIRE_ELIGIBLE:  false,        // true නම් eligible නැත්නම් mint එක abort කරනවා (allowlist-only)
};

// ═══════════════════════════════════════════
// Known function selectors — Contract Type Detection
// ═══════════════════════════════════════════
const SELECTORS = {
  "0x840e15d4": { name: "getMintStats(address)",   type: "SeaDrop"   },
  "0x6489fcad": { name: "mintSeaDrop(...)",         type: "SeaDrop"   },
  "0x2db11544": { name: "mintERC2309(...)",          type: "ERC721A"   },
  "0xa0712d68": { name: "mint(uint256)",             type: "ERC721"    },
  "0x1249c58b": { name: "mint()",                   type: "ERC721"    },
  "0xd9b67a26": { name: "ERC1155 interface",        type: "ERC1155"   },
};

// Gas recommendations per contract type
const GAS_LIMITS = {
  "SeaDrop":   { recommended: 280000, safe: 350000 },
  "ERC721A":   { recommended: 130000, safe: 180000 },
  "ERC721":    { recommended: 180000, safe: 230000 },
  "ERC1155":   { recommended: 100000, safe: 150000 },
  "Unknown":   { recommended: 200000, safe: 280000 },
};

// ═══════════════════════════════════════════
// ABIs
// ═══════════════════════════════════════════
const NFT_ABI = [
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function getMintStats(address minter) view returns (uint256, uint256, uint256)",
];

const SEADROP_ABI = [
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
];

// ═══════════════════════════════════════════
// CONTRACT ANALYZER
// ═══════════════════════════════════════════
async function analyzeContract(provider) {
  console.log("\n🔍 Analyzing contract...");

  let contractType = "Unknown";
  let detectedFunctions = [];

  for (const [selector, info] of Object.entries(SELECTORS)) {
    try {
      await provider.call({ to: CONFIG.NFT_CONTRACT, data: selector });
      detectedFunctions.push(info.name);
      contractType = info.type;
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("execution reverted") || msg.includes("revert")) {
        // Function exists but wrong params — still detected
        detectedFunctions.push(info.name);
        contractType = info.type;
      }
    }
  }

  // Get contract name + supply
  let name = "Unknown";
  let supply = "Unknown";
  try {
    const nft = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, provider);
    name    = await nft.name();
    supply  = (await nft.totalSupply()).toString();
  } catch {}

  const gasInfo = GAS_LIMITS[contractType] || GAS_LIMITS["Unknown"];

  console.log("\n" + "═".repeat(45));
  console.log("📋 CONTRACT ANALYSIS");
  console.log("═".repeat(45));
  console.log(`Name           : ${name}`);
  console.log(`Type           : ${contractType}`);
  console.log(`Total Supply   : ${supply}`);
  console.log(`Functions      : ${detectedFunctions.join(", ") || "None detected"}`);
  console.log("─".repeat(45));
  console.log(`GAS RECOMMENDATION:`);
  console.log(`  Recommended  : ${gasInfo.recommended.toLocaleString()} gas`);
  console.log(`  Safe Limit   : ${gasInfo.safe.toLocaleString()} gas`);
  console.log("═".repeat(45) + "\n");

  return { contractType, gasInfo };
}

// ═══════════════════════════════════════════
// GAS SETTINGS
// ═══════════════════════════════════════════
async function getGasSettings(provider) {
  const block       = await provider.getBlock("latest");
  const baseFee     = block.baseFeePerGas;
  const priorityFee = ethers.parseUnits(CONFIG.PRIORITY_GWEI, "gwei");
  const maxFee      = ethers.parseUnits(CONFIG.MAX_FEE_GWEI, "gwei");

  console.log(`⛽ BaseFee    : ${ethers.formatUnits(baseFee, "gwei")} gwei`);
  console.log(`⛽ Priority   : ${CONFIG.PRIORITY_GWEI} gwei`);
  console.log(`⛽ Max Fee    : ${CONFIG.MAX_FEE_GWEI} gwei`);

  return { maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee };
}

// ═══════════════════════════════════════════
// MINT FUNCTION
// ═══════════════════════════════════════════
async function mint(provider, wallet, gasLimit) {
  console.log("\n🚀 MINTING...");

  const seadrop = new ethers.Contract(CONFIG.SEADROP, SEADROP_ABI, wallet);
  const gas     = await getGasSettings(provider);

  const tx = await seadrop.mintPublic(
    CONFIG.NFT_CONTRACT,
    CONFIG.FEE_RECIPIENT,
    ethers.ZeroAddress,
    1n,
    {
      value:                ethers.parseEther(CONFIG.MINT_PRICE),
      gasLimit:             BigInt(gasLimit),
      maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
      maxFeePerGas:         gas.maxFeePerGas,
    }
  );

  console.log(`✅ TX Sent    : ${tx.hash}`);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await tx.wait();
  console.log(`🎉 MINTED!    Block: ${receipt.blockNumber}`);
  console.log(`   Gas Used   : ${receipt.gasUsed.toLocaleString()}`);
  console.log(`   TX Hash    : ${receipt.hash}`);
}

// ═══════════════════════════════════════════
// TIME TRIGGER
// ═══════════════════════════════════════════
async function waitForMintTime() {
  const mintTime  = CONFIG.MINT_TIME_UTC.getTime();
  const waitTime  = mintTime - Date.now() - 2000; // 2s early

  if (waitTime <= 0) {
    console.log("⚡ Mint time passed — firing now!");
    return;
  }

  const totalSecs = Math.floor(waitTime / 1000);
  const mins      = Math.floor(totalSecs / 60);
  const secs      = totalSecs % 60;
  console.log(`\n⏳ FCFS starts in ${mins}m ${secs}s...`);
  console.log(`   Target: ${CONFIG.MINT_TIME_UTC.toLocaleString()}\n`);

  // Countdown
  const interval = setInterval(() => {
    const remaining = CONFIG.MINT_TIME_UTC.getTime() - Date.now();
    if (remaining <= 0) { clearInterval(interval); return; }
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    process.stdout.write(`\r⏳ ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s remaining...`);
  }, 1000);

  await new Promise(resolve => setTimeout(resolve, waitTime));
  clearInterval(interval);
  console.log("\n");
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
async function main() {
  console.log("═".repeat(45));
  console.log("  NFT MINT BOT — The Beaks FCFS");
  console.log("═".repeat(45));

  // Connect
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet   = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

  console.log(`\n📡 Connected to Ethereum`);
  console.log(`👛 Wallet: ${wallet.address}`);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balEth  = parseFloat(ethers.formatEther(balance));
  const needed  = parseFloat(CONFIG.MINT_PRICE) + 0.045;
  console.log(`💰 Balance: ${balEth.toFixed(4)} ETH`);

  if (balEth < needed) {
    console.log(`\n❌ Insufficient balance!`);
    console.log(`   Needed : ~${needed.toFixed(4)} ETH`);
    console.log(`   Have   : ${balEth.toFixed(4)} ETH`);
    process.exit(1);
  }
  console.log(`✅ Balance OK`);

  // Analyze contract — get recommended gas limit
  const { contractType, gasInfo } = await analyzeContract(provider);
  const gasLimit = gasInfo.safe; // Use safe limit

  console.log(`🎯 Using gas limit: ${gasLimit.toLocaleString()} (${contractType} safe limit)`);

  // Eligibility gate — allowlist/presale stages check (optional)
  if (CONFIG.CHECK_ELIGIBILITY) {
    if (!CONFIG.COLLECTION_SLUG) {
      console.log("⚠️  CHECK_ELIGIBILITY on, but COLLECTION_SLUG හිස් — eligibility check skip කරනවා.");
    } else {
      console.log(`\n🎟️  Checking eligibility (slug: ${CONFIG.COLLECTION_SLUG})...`);
      try {
        const stages = await checkEligibility(CONFIG.PRIVATE_KEY, CONFIG.COLLECTION_SLUG);
        if (stages.length) {
          const str = stages.map(s => `${s.stage}(${s.max_mint})`).join(", ");
          console.log(`✅ Eligible stages: ${str}`);
        } else {
          console.log("ℹ️  Eligible (non-public) stages නෑ — public mint විතරයි.");
          if (CONFIG.REQUIRE_ELIGIBLE) {
            console.log("🛑 REQUIRE_ELIGIBLE on — mint abort කරනවා.");
            process.exit(0);
          }
        }
      } catch (e) {
        console.log(`⚠️  Eligibility check fail: ${e.message}`);
        if (CONFIG.REQUIRE_ELIGIBLE) {
          console.log("🛑 REQUIRE_ELIGIBLE on — safe side එකට mint abort කරනවා.");
          process.exit(1);
        }
        console.log("   → continue කරනවා (public mint try කරන්න).");
      }
    }
  }

  // Wait for mint time
  await waitForMintTime();

  // FIRE!
  console.log("🔥 MINT TIME!");
  await mint(provider, wallet, gasLimit);
}

main().catch(err => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
