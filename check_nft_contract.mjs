/**
 * NFT Contract ABI + Type Checker
 *
 * Usage:
 *   1. npm install ethers
 *   2. node check_nft_contract.mjs
 *
 * ABI file: contract_abi.json (same folder)
 */

import { ethers } from "ethers";
import { writeFileSync } from "fs";

const CONTRACT_ADDRESS = "0xf09a536a1cf28648771c60e85aa422ba87e0cb6b";
const ETHERSCAN_API_KEY = "YOUR_ETHERSCAN_API_KEY"; // https://etherscan.io/myapikey

// ERC165 interface IDs
const INTERFACES = {
  ERC721:            "0x80ac58cd",
  ERC1155:           "0xd9b67a26",
  ERC721_Metadata:   "0x5b5e139f",
  ERC721_Enumerable: "0x780e9d63",
  ERC2981_Royalty:   "0x2a55205a",
};

const DETECT_ABI = [
  "function supportsInterface(bytes4 id) view returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function uri(uint256 id) view returns (string)",
];

// Public Ethereum RPC endpoints
const RPCS = [
  "https://cloudflare-eth.com",
  "https://rpc.ankr.com/eth",
  "https://ethereum.publicnode.com",
  "https://eth.llamarpc.com",
];

async function getProvider() {
  for (const rpc of RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      console.log(`✅ Connected: ${rpc}`);
      return provider;
    } catch {
      console.log(`❌ Failed:   ${rpc}`);
    }
  }
  throw new Error("Could not connect to any RPC");
}

async function getABIFromEtherscan() {
  if (ETHERSCAN_API_KEY === "YOUR_ETHERSCAN_API_KEY") {
    console.log("\n⚠️  Etherscan API key not set — skipping ABI fetch");
    console.log("   Get a free key at: https://etherscan.io/myapikey");
    return null;
  }
  try {
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${CONTRACT_ADDRESS}&apikey=${ETHERSCAN_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "1") {
      return JSON.parse(data.result);
    } else {
      console.log(`⚠️  Etherscan ABI error: ${data.result}`);
      return null;
    }
  } catch (e) {
    console.log(`⚠️  Etherscan fetch failed: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log("=".repeat(50));
  console.log("NFT Contract Checker");
  console.log("=".repeat(50));
  console.log(`Address: ${CONTRACT_ADDRESS}\n`);

  // Connect
  const provider = await getProvider();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, DETECT_ABI, provider);

  // --- Interface Detection ---
  const support = {};
  for (const [name, id] of Object.entries(INTERFACES)) {
    try {
      support[name] = await contract.supportsInterface(id);
    } catch {
      support[name] = false;
    }
  }

  // Determine type
  let contractType = "Unknown (not ERC165 compliant)";
  if (support.ERC721 && support.ERC721_Metadata && support.ERC721_Enumerable) {
    contractType = "ERC-721 (Full: Metadata + Enumerable)";
  } else if (support.ERC721 && support.ERC721_Metadata) {
    contractType = "ERC-721 (with Metadata)";
  } else if (support.ERC721) {
    contractType = "ERC-721 (basic)";
  } else if (support.ERC1155) {
    contractType = "ERC-1155 (Multi-token)";
  }

  // --- Basic Info ---
  let info = {};
  for (const fn of ["name", "symbol", "totalSupply", "owner"]) {
    try {
      info[fn] = String(await contract[fn]());
    } catch {
      info[fn] = "N/A";
    }
  }

  // Test tokenURI / uri
  let uriSample = "N/A";
  try {
    uriSample = await contract.tokenURI(1);
  } catch {
    try {
      uriSample = await contract.uri(1);
    } catch {}
  }

  // --- Print Results ---
  console.log("\n📋 CONTRACT INFO");
  console.log("-".repeat(40));
  console.log(`Type          : ${contractType}`);
  console.log(`ERC-721       : ${support.ERC721}`);
  console.log(`ERC-1155      : ${support.ERC1155}`);
  console.log(`Has Metadata  : ${support.ERC721_Metadata}`);
  console.log(`Has Enumerable: ${support.ERC721_Enumerable}`);
  console.log(`Has Royalty   : ${support.ERC2981_Royalty}`);
  console.log("-".repeat(40));
  console.log(`Name          : ${info.name}`);
  console.log(`Symbol        : ${info.symbol}`);
  console.log(`Total Supply  : ${info.totalSupply}`);
  console.log(`Owner         : ${info.owner}`);
  console.log(`Token URI #1  : ${uriSample}`);

  // --- ABI from Etherscan ---
  console.log("\n📄 Fetching ABI from Etherscan...");
  const abi = await getABIFromEtherscan();
  if (abi) {
    writeFileSync("contract_abi.json", JSON.stringify(abi, null, 2));
    console.log(`✅ ABI saved to: contract_abi.json (${abi.length} entries)`);
  } else {
    console.log("ℹ️  ABI not fetched. Visit Etherscan manually:");
    console.log(`   https://etherscan.io/address/${CONTRACT_ADDRESS}#code`);
  }

  console.log("\n" + "=".repeat(50));
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
