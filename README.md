# Tata AIA Fund Tracker

Nightly data collection for 18 Tata AIA Life ULIP funds, as groundwork for a GitHub Pages performance dashboard.

## What runs

[`.github/workflows/fetch-data.yml`](.github/workflows/fetch-data.yml) runs every night at **02:00 IST** (20:30 UTC). You can also start it manually from the Actions tab. It:

1. Imports any hand-exported NAV history CSVs in `data/import/` ([`scripts/import_csv.py`](scripts/import_csv.py)).
2. Fetches the latest NAVs and the monthly fund fact-sheet data ([`scripts/fetch.py`](scripts/fetch.py)).
3. Commits `data/` only when something changed.

The scripts use only the Python standard library. Each night the job makes 2 HTTP requests.

## Data source

Both feeds are public, unauthenticated JSON files that tataaia.com's own fact-sheet page loads:

| Feed | URL | Gives |
|---|---|---|
| Daily NAV | `https://www.tataaia.com/content/tataaiamfisip/api/fund-daily-nav.json` | Latest NAV for every fund (one date) |
| Fund details | `https://www.tataaia.com/content/tataaiamfisip/api/fund-details.<YYYYMM>.json` | Month-end AUM, asset mix, top-10 holdings, top-10 sectors, 1M–5Y trailing returns, benchmark returns, risk profile |

## Data layout

```
funds.json                     tracked funds (code, SFIN, name)
data/nav/<CODE>.csv            date,nav  – daily history, one row per NAV date
data/portfolio/<YYYYMM>.json   parsed monthly holdings/sectors/returns per fund
data/raw/...                   untouched upstream payloads (for reprocessing)
data/status.json               last run, latest NAV date / portfolio month, staleness
```

## Backfilling history since Jan 2022

The public daily feed only carries the latest day, so older history has to be imported once by hand:

1. Open the [fund performance page](https://www.tataaia.com/customer-service/fund-performance.html).
2. Pick a fund, choose a custom range from 01/01/2022 to today, and click **Download CSV**.
3. Save the file as `data/import/<CODE>.csv`, using the codes in `funds.json` (for example `WLE.csv`).
4. Commit and push. The workflow merges the file into `data/nav/<CODE>.csv`. Re-imports are safe.

## Known limitation

As of 2026-11-16 the upstream public feeds have not refreshed since **2026-08-19** (NAV) and **June 2026** (fact sheet). Their backing service, `sellonline.tataaia.com`, shows a maintenance page. While that lasts:
- the nightly job adds nothing new and lists every fund with no NAV in the last 4 days under `stale_funds` in `data/status.json`, and warns in the run summary;
- it starts collecting again as soon as Tata AIA refreshes the feeds.

## Funds tracked

WLF, WLE, WLS, TLC, WLA, WLI, TSS, ITF, ITT, MCF, ICF, EOF, ESG, DAF, FGF, SCF, RIF, MIF. Names and SFINs are in [`funds.json`](funds.json).

*Not investment advice. Data is © Tata AIA Life Insurance and is reproduced here for personal tracking.*
