#!/usr/bin/env python3
"""One-time backfill: merge NAV history CSVs exported by hand from
https://www.tataaia.com/customer-service/fund-performance.html ("Download CSV")
into data/nav/<CODE>.csv.

Usage: drop files in data/import/ named <CODE>.csv (e.g. WLE.csv), then
    python scripts/import_csv.py

The parser is lenient: it finds the first column that parses as a date and the
first numeric column after it, so minor header/format differences are fine.
Imported files are left in place; re-running is idempotent.
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch import DATA, ROOT, upsert_nav  # noqa: E402

DATE_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d-%b-%Y", "%d %b %Y", "%m/%d/%Y", "%Y/%m/%d")


def parse_date(s: str) -> str | None:
    s = s.strip()[:11].strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_file(path: Path) -> dict[str, float]:
    points: dict[str, float] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.reader(fh):
            d, v = None, None
            for cell in row:
                if d is None:
                    d = parse_date(cell)
                    continue
                try:
                    v = float(cell.replace(",", ""))
                    break
                except ValueError:
                    continue
            if d and v is not None:
                points[d] = round(v, 6)
    return points


SPIKE = 0.15        # a fund NAV never jumps >15% for a single day and straight back
COPY_SPIKE = 0.04   # smaller isolated spikes are dropped if the value is a copy
COPY_GAP_DAYS = 180 # ...of a NAV published at least this far away


def drop_spikes(points: dict[str, float]) -> list[str]:
    """Remove isolated one-row glitches in upstream exports. Tata AIA's CSVs
    contain rows (e.g. 03-01-2010, a Sunday) carrying a NAV copied from another
    date. A row is dropped when it jumps away from BOTH neighbours in the same
    direction by >SPIKE, or by >COPY_SPIKE when its value exactly repeats the
    NAV of a date more than COPY_GAP_DAYS away. Returns the dropped dates."""
    dates = sorted(points)
    by_value: dict[float, list[date]] = {}
    for d, v in points.items():
        by_value.setdefault(v, []).append(date.fromisoformat(d))

    def copied(d: str) -> bool:
        day = date.fromisoformat(d)
        return any(abs((o - day).days) > COPY_GAP_DAYS for o in by_value[points[d]])

    bad = []
    for i in range(1, len(dates) - 1):
        prev, cur, nxt = points[dates[i - 1]], points[dates[i]], points[dates[i + 1]]
        up, down = cur / prev - 1, cur / nxt - 1
        same_dir = (up > 0) == (down > 0)
        size = min(abs(up), abs(down))
        if same_dir and (size > SPIKE or (size > COPY_SPIKE and copied(dates[i]))):
            bad.append(dates[i])
    for d in bad:
        del points[d]
    return bad


def main() -> int:
    codes = {f["code"] for f in json.loads((ROOT / "funds.json").read_text())}
    files = sorted((DATA / "import").glob("*.csv"))
    if not files:
        print("No CSVs in data/import/ - nothing to do.")
        return 0
    for path in files:
        code = path.stem.upper()
        if code not in codes:
            print(f"skip {path.name}: '{code}' is not a code in funds.json")
            continue
        points = parse_file(path)
        if not points:
            print(f"skip {path.name}: no date/NAV rows recognised")
            continue
        for d in drop_spikes(points):
            print(f"{code}: dropped glitch row {d} (isolated one-day spike vs both neighbours)")
        changed = upsert_nav(code, points)
        print(f"{code}: {len(points)} rows read ({min(points)} .. {max(points)}), {changed} new/changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
