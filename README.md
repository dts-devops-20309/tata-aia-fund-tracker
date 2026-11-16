# Tata AIA Fund Tracker

Nightly data collection and a plain-language performance dashboard for 18 Tata AIA Life ULIP funds.

**Dashboard:** https://mchittineni.github.io/tata-aia-fund-tracker/

## Dashboard

A static page (`site/`, no build tools or dependencies) deployed by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) after every data change and every nightly fetch.

- **Overview:** each fund's return over 1 day, 1 week, 2 weeks, 1 month, 3 months, 6 months, 1 year and since Jan 2022 (total and per year), a ranked "which funds did best" chart, and a sortable, filterable table with 12-month sparklines.
- **Fund page** (click any fund):
  - NAV chart with range buttons, and what ₹10,000 invested in Jan 2022 is worth today;
  - the biggest drop from a high, and trailing returns;
  - gain or loss for every day, week, fortnight, month, quarter, half-year and year since Jan 2022, with best, worst and average periods, plus a table view.
- **Holdings drill-down:**
  - the split between shares, bonds and cash;
  - the top 10 stocks and top sectors;
  - fund vs benchmark returns, fund size, manager and risk level.

  These come from the latest monthly fact sheet.

All returns are computed in the browser from `data/nav/*.csv`. They match the 1-year returns Tata AIA publishes, checked for 30 Jun 2026.

Build locally: `python scripts/build_site.py && python -m http.server -d _site`

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
