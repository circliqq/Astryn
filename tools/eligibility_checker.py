import sys
import json
import random
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import csv
from loguru import logger
from curl_cffi.requests import AsyncSession
from pyuseragents import random as random_useragent
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_fixed
from eth_account import Account
from eth_account.messages import encode_defunct

logger.remove()
logger.add(
    'logger.log',
    format='{time:YYYY-MM-DD | HH:mm:ss.SSS} | {level} \t| {function}:{line} - {message}'
)

def level_color(record):
    name = record['level'].name
    if name == 'DEBUG':
        return '{time:YYYY-MM-DD | HH:mm:ss.SSS} | {level} \t| {function}:{line} - {message}\n'
    elif name == 'ERROR':
        return '<level>{time:YYYY-MM-DD | HH:mm:ss.SSS} | {level}</level> \t| {function}:{line} - {message}\n'
    elif name == 'SUCCESS':
        return '<level>{time:YYYY-MM-DD | HH:mm:ss.SSS} | {level}</level> \t| {function}:{line} - {message}\n'

logger.add(
    sys.stdout,
    filter=lambda record: record['level'].name in ('DEBUG', 'ERROR', 'SUCCESS'),
    format=level_color,
    colorize=True
)

PRIVKEYS_FILE = "privkeys.txt"
CHAIN_ID = 1
DEFAULT_COLLECTION_SLUG = ""
proxies = []

# ─────────────────────────────────────────────────────────────
# Phase auto-detection GQL — fetches stage timing info
# ─────────────────────────────────────────────────────────────
PHASE_DETECTION_QUERY = """
query DropPhaseQuery($collectionSlug: String!) {
  dropBySlug(slug: $collectionSlug) {
    stages {
      stageType
      stageIndex
      startTime
      endTime
      maxTotalMintableByWallet
      eligiblePrice {
        usd
        token { unit symbol __typename }
        __typename
      }
      __typename
    }
  }
}
"""


def now_utc_iso_ms() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def ts_for_filename() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def siwe_message_text(domain, address, statement, uri, version, chain_id, nonce, issued_at):
    return (
        f"{domain} wants you to sign in with your account:\n"
        f"{address}\n\n"
        f"{statement}\n\n"
        f"URI: {uri}\n"
        f"Version: {version}\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}"
    )


# ─────────────────────────────────────────────────────────────
# Auto phase detection
# ─────────────────────────────────────────────────────────────
def detect_active_phase(stages: list) -> dict | None:
    """
    From the raw stages list returned by OpenSea, pick the currently
    live phase.  Priority:
      1. A non-PUBLIC_SALE stage whose startTime <= now < endTime
      2. If none is live yet, the next upcoming non-PUBLIC_SALE stage
         (closest startTime in the future)
      3. If all are past, the most-recently ended non-PUBLIC_SALE stage
    Returns a dict with keys: stageType, stageIndex, startTime, endTime, maxMint
    or None if there are no stages at all.
    """
    now_ts = datetime.now(timezone.utc).timestamp()

    def parse_ts(val) -> float | None:
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    candidates = []
    for s in stages:
        if s.get("stageType") == "PUBLIC_SALE":
            continue
        start = parse_ts(s.get("startTime"))
        end   = parse_ts(s.get("endTime"))
        candidates.append({
            "stageType":  s.get("stageType"),
            "stageIndex": s.get("stageIndex"),
            "startTime":  start,
            "endTime":    end,
            "maxMint":    s.get("maxTotalMintableByWallet", 0),
        })

    if not candidates:
        return None

    # 1) Currently live
    live = [c for c in candidates if c["startTime"] is not None and c["endTime"] is not None
            and c["startTime"] <= now_ts < c["endTime"]]
    if live:
        return min(live, key=lambda x: x["startTime"])

    # 2) Upcoming (hasn't started yet)
    upcoming = [c for c in candidates if c["startTime"] is not None and c["startTime"] > now_ts]
    if upcoming:
        return min(upcoming, key=lambda x: x["startTime"])

    # 3) All ended — pick the one that ended most recently
    ended = [c for c in candidates if c["endTime"] is not None]
    if ended:
        return max(ended, key=lambda x: x["endTime"])

    # Fallback: first candidate regardless of times
    return candidates[0]


def format_phase_label(phase: dict) -> str:
    name = phase.get("stageType") or "Unknown"
    idx  = phase.get("stageIndex")
    if idx is not None:
        return f"{name}#{idx}"
    return name


async def fetch_active_phase(collection_slug: str) -> dict | None:
    """
    Makes an unauthenticated GQL call to get stage timing and returns
    the auto-detected active phase dict, or None on failure.
    """
    proxy_config = None
    if proxies:
        proxy = random.choice(proxies)
        ip, port, login_proxy, pass_proxy = proxy.split(':')
        proxy_config = {
            'http':  f'http://{login_proxy}:{pass_proxy}@{ip}:{port}',
            'https': f'http://{login_proxy}:{pass_proxy}@{ip}:{port}',
        }

    async with AsyncSession(
        verify=False,
        impersonate='chrome110',
        headers={
            'accept': 'application/json',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': random_useragent(),
            'content-type': 'application/json',
        },
        proxies=proxy_config
    ) as session:
        await session.get("https://opensea.io")
        payload = {
            "operationName": "DropPhaseQuery",
            "query": PHASE_DETECTION_QUERY,
            "variables": {"collectionSlug": collection_slug},
        }
        r = await session.post("https://gql.opensea.io/graphql", json=payload)
        if r.status_code != 200:
            logger.error(f"Phase detection failed: HTTP {r.status_code}")
            return None
        try:
            j = r.json()
        except Exception:
            logger.error("Phase detection: JSON parse error")
            return None

        if j.get("errors"):
            logger.error(f"Phase detection GQL errors: {j['errors']}")
            return None

        stages = ((j.get("data") or {}).get("dropBySlug") or {}).get("stages") or []
        return detect_active_phase(stages)


# ─────────────────────────────────────────────────────────────
# Eligibility parsing — filter to active phase only
# ─────────────────────────────────────────────────────────────
def parse_stages(drop_data: dict, active_phase: dict | None) -> list:
    """
    Returns eligible stages for this wallet.
    If active_phase is known, only returns that stage (by type+index).
    Otherwise returns all eligible non-PUBLIC_SALE stages.
    """
    stages = drop_data.get("stages") or []
    eligible_stages = []

    for s in stages:
        if not s.get("isEligible"):
            continue
        stage_type  = s.get("stageType")
        stage_idx   = s.get("stageIndex")

        if stage_type == "PUBLIC_SALE":
            continue

        # If we know the active phase, skip stages that don't match
        if active_phase is not None:
            if stage_type != active_phase.get("stageType"):
                continue
            if active_phase.get("stageIndex") is not None and stage_idx != active_phase.get("stageIndex"):
                continue

        if stage_type:
            stage_name = f"{stage_type}#{stage_idx}" if stage_idx is not None else stage_type
        else:
            stage_name = f"Stage{stage_idx}" if stage_idx is not None else "Unknown"

        max_mint = s.get("eligibleMaxTotalMintableByWallet", 0)
        eligible_stages.append({"stage": stage_name, "max_mint": max_mint})

    return eligible_stages


# ─────────────────────────────────────────────────────────────
# Per-wallet eligibility check
# ─────────────────────────────────────────────────────────────
@retry(retry=retry_if_exception(Exception), stop=stop_after_attempt(3), wait=wait_fixed(3), reraise=True)
async def check_one_key(priv_key: str, collection_slug: str, active_phase: dict | None):
    try:
        address = Account.from_key(priv_key).address

        proxy_config = None
        if proxies:
            proxy = random.choice(proxies)
            ip, port, login_proxy, pass_proxy = proxy.split(':')
            proxy_config = {
                'http':  f'http://{login_proxy}:{pass_proxy}@{ip}:{port}',
                'https': f'http://{login_proxy}:{pass_proxy}@{ip}:{port}',
            }

        async with AsyncSession(
            verify=False,
            impersonate='chrome110',
            headers={
                'accept': 'application/json',
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': random_useragent(),
            },
            proxies=proxy_config
        ) as session:

            await session.get("https://opensea.io")

            r_nonce = await session.post(
                "https://opensea.io/__api/auth/siwe/nonce",
                data=b"",
                headers={"content-type": "application/json"},
            )
            if r_nonce.status_code in [403, 429, 500, 502, 503, 504]:
                raise Exception(f"Nonce request failed: {r_nonce.status_code}")
            try:
                nonce = r_nonce.json().get("nonce")
            except Exception:
                raise Exception(f"Nonce parse error: {r_nonce.status_code}")
            if not nonce:
                raise Exception("Nonce empty")

            issued_at = now_utc_iso_ms()
            statement = "Click to sign in and accept the OpenSea Terms of Service (https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy)."
            siwe_dict = {
                "address":   address,
                "chainId":   str(CHAIN_ID),
                "domain":    "opensea.io",
                "issuedAt":  issued_at,
                "nonce":     nonce,
                "statement": statement,
                "uri":       "https://opensea.io/",
                "version":   "1",
            }
            msg = siwe_message_text(
                domain="opensea.io", address=address, statement=statement,
                uri="https://opensea.io/", version="1", chain_id=CHAIN_ID,
                nonce=nonce, issued_at=issued_at,
            )
            signature = Account.sign_message(encode_defunct(text=msg), private_key=priv_key).signature.hex()
            if not signature.startswith("0x"):
                signature = "0x" + signature

            r_verify = await session.post(
                "https://opensea.io/__api/auth/siwe/verify",
                json={"chainArch": "EVM", "message": siwe_dict, "signature": signature},
                headers={"content-type": "application/json"},
            )
            if r_verify.status_code != 200:
                if r_verify.status_code in [403, 429, 500, 502, 503, 504]:
                    raise Exception(f"Verify request failed: {r_verify.status_code}")
                return address, {"__error": f"Verify: {r_verify.status_code}"}

            gql_payload = {
                "operationName": "DropEligibilityQuery",
                "query": """query DropEligibilityQuery($collectionSlug: String!, $address: Address!) {
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
        token { unit symbol contractAddress chain { identifier __typename } __typename }
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
  token { unit symbol contractAddress chain { identifier __typename } __typename }
  __typename
}
fragment UsdPrice on Price {
  usd
  token { contractAddress unit ...currencyIdentifier __typename }
  __typename
}
fragment currencyIdentifier on ContractIdentifier {
  contractAddress
  chain { identifier __typename }
  __typename
}""",
                "variables": {"address": address, "collectionSlug": collection_slug},
            }

            session.cookies.set("connected-account-server-hint", address.lower())
            r_check = await session.post(
                "https://gql.opensea.io/graphql",
                json=gql_payload,
                headers={"content-type": "application/json"},
            )
            if r_check.status_code in [403, 429, 500, 502, 503, 504]:
                raise Exception(f"GQL request failed: {r_check.status_code}")

            try:
                j = r_check.json()
            except Exception:
                raise Exception(f"GQL parse error: {r_check.status_code}")

            if j.get("errors"):
                errors = j.get("errors", [])
                if any("rate limit" in str(err).lower() or "429" in str(err) for err in errors):
                    raise Exception("GQL rate limit error")
                return address, {"__error": "GQL errors"}

            drop = (j.get("data") or {}).get("dropBySlug")
            if not drop:
                return address, {"__error": "No drop data"}

            eligible_stages = parse_stages(drop, active_phase)
            return address, eligible_stages

    except Exception as error:
        raise Exception(error)


# ─────────────────────────────────────────────────────────────
# Worker / queue
# ─────────────────────────────────────────────────────────────
async def worker(priv_key, collection_slug, active_phase, result_map, privkey_map,
                 wallet_num, total, stages_dir):
    try:
        address = Account.from_key(priv_key).address
        privkey_map[address] = priv_key

        addr, eligible_stages = await check_one_key(priv_key, collection_slug, active_phase)
        result_map[addr] = eligible_stages

        has_error = False
        error_msg = None
        if isinstance(eligible_stages, dict) and "__error" in eligible_stages:
            has_error = True
            error_msg = eligible_stages.get("__error", "Unknown error")
        elif isinstance(eligible_stages, list) and eligible_stages:
            first = eligible_stages[0]
            if isinstance(first, dict) and "__error" in first:
                has_error = True
                error_msg = first.get("__error", "Unknown error")

        num_str = f"[{wallet_num}/{total}]".ljust(12)

        if has_error:
            logger.error(f'{num_str}{addr} | {error_msg}')
        elif isinstance(eligible_stages, list) and eligible_stages:
            valid = [s for s in eligible_stages if isinstance(s, dict) and "stage" in s]
            if valid:
                for stage_info in valid:
                    stage_name = stage_info.get("stage")
                    if stage_name:
                        with open(stages_dir / f"{stage_name}.txt", "a", encoding="utf-8") as f:
                            f.write(f"{addr}:{priv_key}\n")
                stages_str = ", ".join([f"{s['stage']}({s['max_mint']})" for s in valid])
                logger.success(f'{num_str}{addr} | {stages_str}')
            else:
                logger.success(f'{num_str}{addr} | Not eligible')
        else:
            logger.success(f'{num_str}{addr} | Not eligible')

    except Exception as error:
        addr = Account.from_key(priv_key).address
        num_str = f"[{wallet_num}/{total}]".ljust(12)
        logger.error(f'{num_str}{addr} | {error}')
        result_map[addr] = [{"__error": str(error)}]
        privkey_map[addr] = priv_key


async def _main(collection_slug, active_phase, result_map, privkey_map,
                wallet_num_map, total, stages_dir, worker_id):
    while not q.empty():
        try:
            priv_key = await q.get()
            wallet_num = wallet_num_map.get(priv_key, 0)
            await worker(priv_key, collection_slug, active_phase, result_map,
                         privkey_map, wallet_num, total, stages_dir)
            await asyncio.sleep(1.5)
        except Exception as error:
            logger.error(f'{error}')
            await asyncio.sleep(5)


async def main(collection_slug, active_phase, result_map, privkey_map,
               wallet_num_map, total, stages_dir):
    tasks = [
        asyncio.create_task(
            _main(collection_slug, active_phase, result_map, privkey_map,
                  wallet_num_map, total, stages_dir, i)
        )
        for i in range(THREADS)
    ]
    await asyncio.gather(*tasks)


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    THREADS = 3
    DELAY   = 1.5

    # Proxies
    try:
        with open('proxy.txt', 'r', encoding='utf-8') as f:
            proxies = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        proxies = []

    # Private keys
    try:
        with open(PRIVKEYS_FILE, 'r', encoding='utf-8') as f:
            priv_keys = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        logger.error(f'File not found: {PRIVKEYS_FILE}')
        input("press enter to exit")
        exit(1)

    if not priv_keys:
        logger.error("privkeys.txt is empty")
        input("press enter to exit")
        exit(1)

    # Collection slug
    collection_slug = DEFAULT_COLLECTION_SLUG
    if not collection_slug:
        collection_slug = input("Collection slug: ").strip()
    if not collection_slug:
        logger.error("No collection slug provided")
        input("press enter to exit")
        exit(1)

    # ── Auto phase detection ──────────────────────────────────
    logger.debug(f"Detecting active phase for '{collection_slug}' ...")
    active_phase = asyncio.run(fetch_active_phase(collection_slug))

    if active_phase:
        label = format_phase_label(active_phase)
        start = active_phase.get("startTime")
        end   = active_phase.get("endTime")
        now_ts = datetime.now(timezone.utc).timestamp()

        if start and end and start <= now_ts < end:
            status_str = "LIVE"
        elif start and start > now_ts:
            dt = datetime.fromtimestamp(start, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            status_str = f"UPCOMING — starts {dt}"
        else:
            status_str = "ENDED"

        logger.debug(f"Auto-detected phase: {label}  [{status_str}]")
        print(f"\n  Phase detected: {label}  [{status_str}]")
        print(f"  Press Enter to use this phase, or type a phase name to override: ", end="")
        override = input().strip()
        if override:
            # Manual override: reconstruct a minimal phase dict so the filter still works
            # Try to parse   TYPE   or   TYPE#INDEX
            if '#' in override:
                parts = override.split('#', 1)
                active_phase = {"stageType": parts[0], "stageIndex": int(parts[1])}
            else:
                active_phase = {"stageType": override, "stageIndex": None}
            logger.debug(f"Phase overridden to: {override}")
    else:
        logger.debug("Could not detect phase automatically — checking all non-PUBLIC_SALE stages")
        print("\n  Could not detect phase automatically. Checking all non-PUBLIC_SALE stages.\n")

    print()

    # Output dirs
    result_map  = {}
    privkey_map = {}
    wallet_num_map = {key: num for num, key in enumerate(priv_keys, 1)}

    out_dir    = Path("out")
    out_dir.mkdir(exist_ok=True)
    ts         = ts_for_filename()
    stages_dir = out_dir / f"stages_{collection_slug}_{ts}"
    stages_dir.mkdir(exist_ok=True)

    total = len(priv_keys)
    q = asyncio.Queue()
    for key in priv_keys:
        q.put_nowait(key)

    asyncio.run(main(collection_slug, active_phase, result_map, privkey_map,
                     wallet_num_map, total, stages_dir))

    # ── Save outputs ──────────────────────────────────────────
    json_path = out_dir / f"eligibility_{collection_slug}_{ts}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result_map, f, ensure_ascii=False, indent=2)

    csv_path = out_dir / f"eligibility_{collection_slug}_{ts}.csv"
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Address", "Eligible Stages"])
        for addr, stages in result_map.items():
            if stages and "__error" not in str(stages):
                stages_str = ", ".join([f"{s['stage']}({s['max_mint']})" for s in stages])
            elif not stages:
                stages_str = "Not eligible"
            else:
                stages_str = "ERROR"
            writer.writerow([addr, stages_str])

    # Stage file stats
    stats = {}
    for stage_file in stages_dir.glob("*.txt"):
        stage_name = stage_file.stem
        with open(stage_file, "r", encoding="utf-8") as f:
            stats[stage_name] = len([ln for ln in f if ln.strip()])

    logger.success(f'Saved: {json_path}')
    logger.success(f'Saved: {csv_path}')
    logger.success(f'Stages dir: {stages_dir}')
    logger.success("\n" + "=" * 80)
    logger.success("STATS:")
    logger.success("=" * 80)

    total_checked     = len(result_map)
    total_eligible    = sum(1 for s in result_map.values() if s and "__error" not in str(s))
    total_not_eligible= sum(1 for s in result_map.values() if not s)
    total_errors      = sum(1 for s in result_map.values() if s and "__error" in str(s))

    logger.success(f"Checked:      {total_checked}")
    logger.success(f"Eligible:     {total_eligible}")
    logger.success(f"Not eligible: {total_not_eligible}")
    logger.success(f"Errors:       {total_errors}")
    logger.success("")
    logger.success("By stage:")
    for stage_name, count in sorted(stats.items()):
        logger.success(f"  {stage_name}: {count}")
    logger.success("=" * 80)

    input('Press Enter to exit...')
