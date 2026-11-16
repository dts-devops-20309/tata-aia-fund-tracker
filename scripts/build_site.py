#!/usr/bin/env python3
"""Assemble the static GitHub Pages site into _site/.

Copies site/ (HTML/CSS/JS) and writes _site/data.json, a single compact file
holding every tracked fund's NAV history plus its latest monthly portfolio.
All metrics are computed in the browser from this file.
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import DATA, ROOT, read_nav_csv  # noqa: E402

OUT = ROOT / "_site"


def latest_portfolio() -> tuple[str | None, dict]:
    files = sorted((DATA / "portfolio").glob("*.json"))
    if not files:
        return None, {}
    doc = json.loads(files[-1].read_text())
    return doc["month"], doc["funds"]


def main() -> int:
    funds = json.loads((ROOT / "funds.json").read_text())
    month, portfolio = latest_portfolio()
    status = json.loads((DATA / "status.json").read_text()) if (DATA / "status.json").exists() else {}

    out_funds = []
    for f in funds:
        series = read_nav_csv(DATA / "nav" / f"{f['code']}.csv")
        dates = sorted(series)
        out_funds.append({
            **f,
            "d": dates,
            "v": [series[d] for d in dates],
            "portfolio": portfolio.get(f["code"]),
        })

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "portfolio_month": month,
        "feed_nav_date": status.get("feed_nav_date"),
        "funds": out_funds,
    }

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "site", OUT)
    (OUT / "data.json").write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    (OUT / ".nojekyll").write_text("")
    size_kb = (OUT / "data.json").stat().st_size / 1024
    print(f"built {OUT} — {len(out_funds)} funds, data.json {size_kb:.0f} KB, portfolio {month}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
