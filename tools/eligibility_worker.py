#!/usr/bin/env python3
"""
Eligibility worker — called by the Node.js API as a subprocess.

Single-wallet mode (legacy):
  stdin:  {"slug": "collection-slug", "privkey": "0x..."}
  stdout: {"eligible": true, "stages": ["GTD#0"], "error": null}

Bulk mode (preferred):
  stdin:  {"slug": "...", "wallets": [{"address": "0x...", "privkey": "0x..."}, ...],
           "threads": 3, "delay": 1.5, "proxies": ["ip:port:login:pass", ...]}
  stdout: {"results": [{"address": "0x...", "eligible": true, "stages": [...], "error": null}, ...]}

Exit code is always 0 (errors returned in JSON).
"""
import sys
import json
import asyncio
import random
from datetime import datetime, timezone

try:
    from eth_account import Account
    from eth_account.messages import encode_defunct
    ETH_ACCOUNT_IMPORT_ERROR = None
except ImportError as exc:
    Account = None
    encode_defunct = None
    ETH_ACCOUNT_IMPORT_ERROR = str(exc)

try:
    from curl_cffi.requests import AsyncSession
except ImportError:
    AsyncSession = None

try:
    from pyuseragents import random as random_useragent
except ImportError:
    def random_useragent():
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/110.0.0.0 Safari/537.36"


def now_utc_iso_ms() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_proxy_config(proxy_str: str):
    """Parse ip:port:login:pass or ip:port proxy string."""
    try:
        parts = proxy_str.split(":")
        if len(parts) == 4:
            ip, port, login, pwd = parts
            url = f"http://{login}:{pwd}@{ip}:{port}"
        elif len(parts) == 2:
            ip, port = parts
            url = f"http://{ip}:{port}"
        else:
            return None
        return {"http": url, "https": url}
    except Exception:
        return None


async def check_one(slug: str, address: str, privkey: str, proxy_config) -> dict:
    """Check eligibility for a single wallet."""
    if Account is None or encode_defunct is None:
        return {"address": address, "eligible": False, "stages": [], "error": f"eth_account not installed: {ETH_ACCOUNT_IMPORT_ERROR}"}
    if AsyncSession is None:
        return {"address": address, "eligible": False, "stages": [], "error": "curl_cffi not installed"}

    try:
        async with AsyncSession(
            verify=False,
            impersonate="chrome110",
            headers={
                "accept": "application/json, text/plain, */*",
                "accept-language": "en-US,en;q=0.9",
                "user-agent": random_useragent(),
            },
            proxies=proxy_config,
        ) as session:

            # 1) Warm-up — collect Cloudflare cookies
            await session.get("https://opensea.io")

            # 2) Nonce
            r_nonce = await session.post(
                "https://opensea.io/__api/auth/siwe/nonce",
                data=b"",
                headers={"content-type": "application/json"},
            )
            if r_nonce.status_code in [403, 429, 500, 502, 503, 504]:
                return {"address": address, "eligible": False, "stages": [], "error": f"Nonce {r_nonce.status_code}"}
            if r_nonce.status_code != 200:
                return {"address": address, "eligible": False, "stages": [], "error": f"Nonce failed: {r_nonce.status_code}"}

            nonce = r_nonce.json().get("nonce")
            if not nonce:
                return {"address": address, "eligible": False, "stages": [], "error": "Nonce empty"}

            # 3) Build + sign SIWE message
            issued_at = now_utc_iso_ms()
            statement = (
                "Click to sign in and accept the OpenSea Terms of Service "
                "(https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy)."
            )
            siwe_message = (
                f"opensea.io wants you to sign in with your account:\n"
                f"{address}\n\n"
                f"{statement}\n\n"
                f"URI: https://opensea.io/\n"
                f"Version: 1\n"
                f"Chain ID: 1\n"
                f"Nonce: {nonce}\n"
                f"Issued At: {issued_at}"
            )
            sig = Account.sign_message(encode_defunct(text=siwe_message), private_key=privkey).signature.hex()
            if not sig.startswith("0x"):
                sig = "0x" + sig

            # 4) Verify (establish authenticated session)
            r_verify = await session.post(
                "https://opensea.io/__api/auth/siwe/verify",
                json={
                    "chainArch": "EVM",
                    "message": {
                        "address": address,
                        "chainId": "1",
                        "domain": "opensea.io",
                        "issuedAt": issued_at,
                        "nonce": nonce,
                        "statement": statement,
                        "uri": "https://opensea.io/",
                        "version": "1",
                    },
                    "signature": sig,
                },
                headers={"content-type": "application/json"},
            )
            if r_verify.status_code in [403, 429, 500, 502, 503, 504]:
                return {"address": address, "eligible": False, "stages": [], "error": f"Verify {r_verify.status_code}"}
            if r_verify.status_code != 200:
                return {"address": address, "eligible": False, "stages": [], "error": f"Verify failed: {r_verify.status_code}"}

            # 5) DropEligibilityQuery — full query matching the reference implementation
            session.cookies.set("connected-account-server-hint", address.lower())
            GQL_QUERY = """query DropEligibilityQuery($collectionSlug: String!, $address: Address!) {
  dropBySlug(slug: $collectionSlug) {
    __typename
    ... on Erc721SeaDropV1 {
      minterQuantityMinted(minter: $address)
      __typename
    }
    stages {
      stageType
      stageIndex
      isEligible
      maxTotalMintableByWallet
      eligibleMaxTotalMintableByWallet
      eligiblePrice {
        ...TokenPrice
        ...UsdPrice
        usd
        token {
          unit
          symbol
          contractAddress
          chain { identifier __typename }
          __typename
        }
        __typename
      }
      ... on Erc1155SeaDropV2Stage {
        fromTokenId
        toTokenId
        maxTotalMintableByWalletPerToken
        eligibleMaxTotalMintableByWalletPerToken
        __typename
      }
      __typename
    }
  }
}
fragment TokenPrice on Price {
  usd
  token {
    unit
    symbol
    contractAddress
    chain { identifier __typename }
    __typename
  }
  __typename
}
fragment UsdPrice on Price {
  usd
  token {
    contractAddress
    unit
    ...currencyIdentifier
    __typename
  }
  __typename
}
fragment currencyIdentifier on ContractIdentifier {
  contractAddress
  chain { identifier __typename }
  __typename
}"""
            r_gql = await session.post(
                "https://gql.opensea.io/graphql",
                json={
                    "operationName": "DropEligibilityQuery",
                    "query": GQL_QUERY,
                    "variables": {"address": address, "collectionSlug": slug},
                },
                headers={"content-type": "application/json"},
            )
            if r_gql.status_code in [403, 429, 500, 502, 503, 504]:
                return {"address": address, "eligible": False, "stages": [], "error": f"GQL {r_gql.status_code}"}
            if r_gql.status_code != 200:
                return {"address": address, "eligible": False, "stages": [], "error": f"GQL failed: {r_gql.status_code}"}

            data = r_gql.json()
            if data.get("errors"):
                errors = data["errors"]
                if any("rate limit" in str(e).lower() or "429" in str(e) for e in errors):
                    return {"address": address, "eligible": False, "stages": [], "error": "GQL rate limit"}
                return {"address": address, "eligible": False, "stages": [], "error": f"GQL errors: {errors}"}

            drop = ((data.get("data") or {}).get("dropBySlug")) or {}
            raw_stages = drop.get("stages") or []

            def normalize_stage_type(raw: str) -> str:
                """Map OpenSea stage type strings to our internal phaseType names."""
                r = (raw or "").upper()
                if "GUARANTEED" in r or r == "GTD":
                    return "GTD"
                if "FCFS" in r:
                    return "FCFS"
                if "ALLOW" in r:
                    return "ALLOWLIST"
                if "PUBLIC" in r:
                    return "PUBLIC"
                return raw  # keep unknown as-is

            eligible_stages = []
            for s in raw_stages:
                if s.get("isEligible") and s.get("stageType") != "PUBLIC_SALE":
                    stage_type = normalize_stage_type(s.get("stageType", "UNKNOWN"))
                    stage_idx = s.get("stageIndex")
                    name = f"{stage_type}#{stage_idx}" if stage_idx is not None else stage_type
                    eligible_stages.append(name)

            return {
                "address": address,
                "eligible": len(eligible_stages) > 0,
                "stages": eligible_stages,
                "error": None,
            }

    except Exception as exc:
        return {"address": address, "eligible": False, "stages": [], "error": str(exc)}


async def check_with_retry(slug: str, address: str, privkey: str, proxy_config,
                           max_attempts: int = 3, delay: float = 3.0) -> dict:
    """check_one with retry on error."""
    last_result = {"address": address, "eligible": False, "stages": [], "error": "No attempts"}
    for attempt in range(max_attempts):
        result = await check_one(slug, address, privkey, proxy_config)
        last_result = result
        if result["error"] is None:
            return result
        if attempt < max_attempts - 1:
            await asyncio.sleep(delay)
    return last_result


async def bulk_check(slug: str, wallets: list, threads: int = 3,
                     delay: float = 1.5, proxies: list = None) -> list:
    """Check all wallets concurrently, up to `threads` at a time."""
    if proxies is None:
        proxies = []

    semaphore = asyncio.Semaphore(threads)
    results = []

    async def run_one(w):
        proxy_config = build_proxy_config(random.choice(proxies)) if proxies else None
        async with semaphore:
            result = await check_with_retry(slug, w["address"], w["privkey"], proxy_config)
            results.append(result)
            await asyncio.sleep(delay)

    await asyncio.gather(*[run_one(w) for w in wallets])
    return results


if __name__ == "__main__":
    try:
        inp = json.loads(sys.stdin.read())
        slug = inp["slug"]

        if "wallets" in inp:
            # ── Bulk mode ─────────────────────────────────────────────────────
            wallets  = inp["wallets"]             # [{"address": "0x...", "privkey": "0x..."}, ...]
            threads  = int(inp.get("threads", 3))
            delay    = float(inp.get("delay", 1.5))
            proxies  = inp.get("proxies", [])
            results  = asyncio.run(bulk_check(slug, wallets, threads, delay, proxies))
            print(json.dumps({"results": results}))

        else:
            # ── Single-wallet legacy mode ─────────────────────────────────────
            privkey = inp["privkey"]
            address = Account.from_key(privkey).address
            result  = asyncio.run(check_with_retry(slug, address, privkey, None))
            print(json.dumps({"eligible": result["eligible"],
                               "stages":   result["stages"],
                               "error":    result["error"]}))

    except Exception as exc:
        print(json.dumps({"eligible": False, "stages": [], "error": str(exc)}))

    sys.exit(0)
