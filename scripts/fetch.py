#!/usr/bin/env python3
"""Nightly fetch of Tata AIA ULIP fund data from the insurer's public JSON feeds.

Sources (plain GET, no auth, the same files tataaia.com's fact-sheet page loads):
  - fund-daily-nav.json      latest NAV for every fund (one date per file)
  - fund-details.<YYYYMM>.json  monthly fact-sheet data: AUM, asset mix, top-10
                             holdings, top sectors, trailing returns, benchmark

Outputs (only rewritten when content changes, so git history stays clean):
  data/nav/<CODE>.csv               date,nav  (one row per NAV date, upserted)
  data/portfolio/<YYYYMM>.json      parsed monthly details for tracked funds
  data/raw/daily-nav/<YYYYMMDD>.json, data/raw/fund-details/<YYYYMM>.json
  data/status.json                  last run, latest dates, staleness

Stdlib only so the GitHub Action needs no dependency install.
"""

from __future__ import annotations

import csv
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BASE = "https://www.tataaia.com/content/tataaiamfisip/api"
USER_AGENT = "tata-aia-fund-tracker/1.0 (personal NAV tracker; nightly, ~2 requests)"
STALE_AFTER_DAYS = 4  # weekends + one holiday


def get_json(url: str, attempts: int = 3) -> dict:
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except Exception as exc:  # noqa: BLE001 - retry any network/parse error
            if i == attempts - 1:
                raise
            print(f"retry {i + 1} for {url}: {exc}", file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise AssertionError("unreachable")


def write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text() == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return True


def dump(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def num(v: str | None) -> float | None:
    try:
        return round(float(v), 6) if v not in (None, "") else None
    except ValueError:
        return None


def load_funds() -> dict[str, dict]:
    return {f["code"]: f for f in json.loads((ROOT / "funds.json").read_text())}


def read_nav_csv(path: Path) -> dict[str, float]:
    if not path.exists():
        return {}
    with path.open() as fh:
        return {row["date"]: float(row["nav"]) for row in csv.DictReader(fh)}


def write_nav_csv(path: Path, series: dict[str, float]) -> bool:
    lines = ["date,nav"] + [f"{d},{series[d]}" for d in sorted(series)]
    return write_if_changed(path, "\n".join(lines) + "\n")


def upsert_nav(code: str, points: dict[str, float]) -> int:
    """Merge points into data/nav/<code>.csv; returns number of new/changed dates."""
    path = DATA / "nav" / f"{code}.csv"
    series = read_nav_csv(path)
    changed = sum(1 for d, v in points.items() if series.get(d) != v)
    series.update(points)
    write_nav_csv(path, series)
    return changed


def fetch_daily_nav(funds: dict[str, dict]) -> dict:
    payload = get_json(f"{BASE}/fund-daily-nav.json")
    nav = payload["responseJson"]["nav"]
    cols = nav["columns"]
    i_day, i_code, i_nav = cols.index("Day"), cols.index("FUND"), cols.index("Daily Nav Fund")

    dates = sorted({r[i_day] for r in nav["data"]})
    if dates:
        write_if_changed(DATA / "raw" / "daily-nav" / f"{dates[-1]}.json", dump(payload))

    added, latest = 0, None
    for row in nav["data"]:
        code = row[i_code].strip()
        if code not in funds:
            continue
        d = datetime.strptime(row[i_day], "%Y%m%d").date().isoformat()
        v = num(row[i_nav])
        if v is None:
            continue
        added += upsert_nav(code, {d: v})
        latest = max(latest or d, d)
    return {"latest_nav_date": latest, "new_points": added}


PERIODS = ["1 Month", "3 Months", "6 Months", "1 Year", "2 Years", "3 Years", "4 Years", "5 Years"]


def parse_details_row(row: list[str], cols: list[str]) -> dict:
    g = dict(zip(cols, row))

    def pairs(prefix: str, n: int, pct_suffix: str = " %") -> list[dict]:
        out = []
        for k in range(1, n + 1):
            name = (g.get(f"{prefix} {k}") or "").strip()
            pct = num(g.get(f"{prefix} {k}{pct_suffix}"))
            if name:
                out.append({"name": name, "pct": pct})
        return out

    sectors = pairs("Sector", 10)
    if (g.get("Other Sector") or "").strip():
        sectors.append({"name": "Others", "pct": num(g.get("Other Sector %"))})

    def trailing(prefix: str) -> dict:
        # Columns look like "<prefix>Last 1 Year NAV" / "... NAV Change %" and
        # "<prefix>Since Inception  NAV" (note the double space upstream).
        labels = {p.lower().replace(" ", "_"): f"{prefix}Last {p}" for p in PERIODS}
        labels["since_inception"] = f"{prefix}Since Inception "
        return {
            key: {"nav": num(g.get(f"{col} NAV")), "change_pct": num(g.get(f"{col} NAV Change %"))}
            for key, col in labels.items()
        }

    return {
        "month": g.get("Month"),
        "sfin": (g.get("SFIN No.") or "").strip(),
        "official_name": (g.get("FundName") or "").strip(),
        "manager": (g.get("Fund Manager") or "").strip(),
        "objective": (g.get("Fund Objective") or "").strip(),
        "type": (g.get("FundType") or "").strip(),
        "risk": (g.get("RiskProfile") or "").strip(),
        "aum_cr": num(g.get("AUM / Fund Corpus")),
        "benchmark": (g.get("Benchmark Index") or "").strip(),
        "asset_mix": {
            "equity_pct": num(g.get("Equity Ratio")),
            "debt_pct": num(g.get("Debt Ratio")),
            "mmi_others_pct": num(g.get("MMI & Others Ratio")),
        },
        "holdings": pairs("Holding", 10),
        "sectors": sectors,
        "returns": trailing(""),
        "benchmark_returns": trailing("BenchmarkIndex "),
    }


def fetch_fund_details(funds: dict[str, dict]) -> dict:
    # The site requests the current month and falls back; the feed returns the
    # latest published month regardless, and tells us which one in "Month".
    payload = get_json(f"{BASE}/fund-details.{date.today():%Y%m}.json")
    rj = payload["responseJson"]
    month = rj.get("Month")
    fd = rj["fundDetails"]
    cols = fd["columns"]
    by_sfin = {f["sfin"]: code for code, f in funds.items()}

    parsed = {}
    for row in fd["data"]:
        rec = parse_details_row(row, cols)
        code = by_sfin.get(rec["sfin"])
        if code:
            parsed[code] = rec

    write_if_changed(DATA / "raw" / "fund-details" / f"{month}.json", dump(payload))
    changed = write_if_changed(DATA / "portfolio" / f"{month}.json", dump({"month": month, "funds": parsed}))
    missing = sorted(set(funds) - set(parsed))
    return {"latest_portfolio_month": month, "portfolio_changed": changed, "missing_in_details": missing}


def main() -> int:
    funds = load_funds()
    status: dict = {"run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "errors": []}

    for name, fn in (("daily_nav", fetch_daily_nav), ("fund_details", fetch_fund_details)):
        try:
            status.update(fn(funds))
        except Exception as exc:  # noqa: BLE001 - keep going, record in status
            status["errors"].append(f"{name}: {exc}")
            print(f"::error::{name} failed: {exc}")

    prev = json.loads((DATA / "status.json").read_text()) if (DATA / "status.json").exists() else {}
    # What the public feed reported this run (may lag behind imported CSVs).
    status["feed_nav_date"] = status.pop("latest_nav_date", None) or prev.get("feed_nav_date")
    status.setdefault("latest_portfolio_month", prev.get("latest_portfolio_month"))

    # Per-fund coverage from the stored history (feed + CSV imports).
    today = date.today()
    coverage = {}
    for code in sorted(funds):
        series = read_nav_csv(DATA / "nav" / f"{code}.csv")
        if series:
            last = max(series)
            coverage[code] = {"first": min(series), "last": last, "points": len(series),
                              "stale": (today - date.fromisoformat(last)).days > STALE_AFTER_DAYS}
    status["funds"] = coverage
    stale = [c for c, v in coverage.items() if v["stale"]]
    status["stale_funds"] = stale
    if stale:
        print(f"::warning::{len(stale)} fund(s) have no NAV in the last {STALE_AFTER_DAYS} days: {', '.join(stale)}")

    # Only rewrite status.json when something other than the timestamp moved,
    # so a quiet night does not create a commit.
    comparable = {k: v for k, v in status.items() if k not in ("run_at", "new_points", "portfolio_changed")}
    prev_cmp = {k: v for k, v in prev.items() if k not in ("run_at", "new_points", "portfolio_changed")}
    if comparable != prev_cmp or status.get("new_points") or status.get("portfolio_changed"):
        write_if_changed(DATA / "status.json", dump(status))

    print(json.dumps(status, indent=2))
    return 1 if len(status["errors"]) == 2 else 0


if __name__ == "__main__":
    sys.exit(main())
