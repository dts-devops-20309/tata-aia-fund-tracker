# Tata AIA Fund Tracker

[![Fetch fund data](https://github.com/dts-devops-20309/tata-aia-fund-tracker/actions/workflows/fetch-data.yml/badge.svg)](https://github.com/dts-devops-20309/tata-aia-fund-tracker/actions/workflows/fetch-data.yml)
[![Deploy dashboard](https://github.com/dts-devops-20309/tata-aia-fund-tracker/actions/workflows/pages.yml/badge.svg)](https://github.com/dts-devops-20309/tata-aia-fund-tracker/actions/workflows/pages.yml)

Collects NAV and fact-sheet data for **18 Tata AIA Life ULIP funds** every night and shows it on a plain-language dashboard. Returns are measured **from January 2023**.

**Live dashboard:** <https://dts-devops-20309.github.io/mutual-fund-tracker/>

---

## Contents

- [Highlights](#highlights)
- [Architecture](#architecture)
- [Dashboard](#dashboard)
- [How returns are calculated](#how-returns-are-calculated)
- [Automation](#automation)
- [Data source](#data-source)
- [Data layout](#data-layout)
- [Running locally](#running-locally)
- [Backfilling NAV history](#backfilling-nav-history)
- [Configuration](#configuration)
- [Operations and troubleshooting](#operations-and-troubleshooting)
- [Funds tracked](#funds-tracked)
- [Disclaimer](#disclaimer)

## Highlights

- **No dependencies.** The Python scripts use only the standard library. The site is plain HTML, CSS and JavaScript with no build step and no third-party libraries.
- **Git is the database.** Every NAV point and monthly fact sheet is versioned in `data/`, and the bot commits only when something changes.
- **Light on the source.** Each nightly run makes 2 HTTP requests to public, unauthenticated feeds.
- **Checked against the insurer.** All returns are computed in the browser from the stored NAV history. They match the 1-year returns Tata AIA published for 30 Jun 2026.
- **Hardened CI.** Every action is pinned to a full commit SHA, Dependabot keeps those pins current, and each workflow gets only the permissions it needs.

## Architecture

```text
            ┌────────────────────────────┐
 02:00 IST  │  fetch-data.yml (nightly)  │
 ─────────▶ │  import_csv.py → fetch.py  │──── commits ───▶ data/  (NAV CSVs, portfolios, raw payloads, status)
            └──────────────┬─────────────┘
                           │ workflow_run (on success)
                           ▼
            ┌────────────────────────────┐
            │  pages.yml                 │
            │  build_site.py → _site/    │──── deploy ────▶ GitHub Pages
            └────────────────────────────┘
                                                   browser: app.js reads data.json and computes every metric
```

| Component | Path | Role |
| --- | --- | --- |
| Fetcher | [`scripts/fetch.py`](scripts/fetch.py) | Pulls the latest NAVs and the monthly fact sheet, adds new rows to the NAV history, writes `status.json` |
| Backfill importer | [`scripts/import_csv.py`](scripts/import_csv.py) | Merges hand-exported NAV CSVs from `data/import/` and drops isolated one-day glitch rows |
| Site builder | [`scripts/build_site.py`](scripts/build_site.py) | Copies `site/` to `_site/` and bundles all history into one `data.json` |
| Dashboard | [`site/`](site/) | Static single-page app with hash routing and SVG charts |

## Dashboard

**Overview**
- Returns over 1 day, 1 week, 2 weeks, 1 month, 3 months, 6 months and 1 year.
- Return since Jan 2023, as a total and as an average per year.
- A ranked "which funds did best" chart.
- A sortable, filterable table with 12-month sparklines.

**Fund page** (click any fund)
- NAV chart with ranges of 1M, 3M, 6M, 1Y, 3Y, since Jan '23, and all history.
- What ₹10,000 invested in Jan 2023 (or at launch) is worth today.
- The biggest drop from a high, with its peak and trough dates.
- Gain or loss for every day, week, fortnight, month, quarter, half-year and year since Jan 2023. Shows the best, worst and average period, with a table view.

**Holdings**, from the latest monthly fact sheet
- The split between shares, bonds and cash.
- The top 10 stocks and the top sectors.
- Fund vs benchmark returns, fund size (AUM), fund manager and risk level.

## How returns are calculated

| Metric | Definition |
| --- | --- |
| Trailing return (1D…1Y) | `NAV_latest / NAV_base − 1`. The base is the last NAV on or before the same date one period earlier. |
| Since Jan 2023 | The base is the last NAV on or before **1 Jan 2023**. Funds launched later use their launch NAV and are labelled "since launch". |
| Per year | Compound annual growth rate since the base date. Shown only when at least 1 year of data exists. |
| Biggest drop | The largest fall from a running high to a later low, measured from the base date. |
| Period returns | Each period's closing NAV compared with the previous period's closing NAV. Fortnights start on Monday 2 Jan 2023. The newest period is shown as "to date". |

The start date is the `SINCE` constant at the top of [`site/app.js`](site/app.js). The dashboard builds every "since …" label from it. The full NAV history back to each fund's launch stays in `data/nav/` and is still shown by the chart's **All** range.

## Automation

| Workflow | Trigger | What it does | Permissions |
| --- | --- | --- | --- |
| [`fetch-data.yml`](.github/workflows/fetch-data.yml) | Daily at 20:30 UTC (02:00 IST), manual, or a push that changes `data/import/**`, `funds.json` or `scripts/**` | Imports backfill CSVs, fetches NAV and fact-sheet data, writes a run summary, commits `data/` only if something changed | `contents: write` |
| [`pages.yml`](.github/workflows/pages.yml) | A push that changes the site or data, success of the fetch workflow, or manual | Builds `_site/` and deploys it to GitHub Pages | `contents: read`, `pages: write`, `id-token: write` |
| [`dependabot.yml`](.github/dependabot.yml) | Weekly | Opens one grouped PR that bumps the pinned action SHAs | n/a |

Notes:
- Commits pushed with `GITHUB_TOKEN` don't trigger `push` workflows, so `pages.yml` also listens for `workflow_run`. It deploys only after the fetch succeeds.
- Each workflow has a concurrency group. Fetches never overlap, and a newer Pages deploy cancels an older one.
- The fetch job rebases before it pushes, so it doesn't race manual commits.

## Data source

Both feeds are public, unauthenticated JSON files. They are the same files that tataaia.com's own fact-sheet page loads.

| Feed | URL | Provides |
| --- | --- | --- |
| Daily NAV | `https://www.tataaia.com/content/tataaiamfisip/api/fund-daily-nav.json` | The latest NAV for every fund (one date only) |
| Fund details | `https://www.tataaia.com/content/tataaiamfisip/api/fund-details.<YYYYMM>.json` | Month-end AUM, asset mix, top-10 holdings and sectors, 1M–5Y trailing returns, benchmark returns, risk profile |

## Data layout

```text
funds.json                              tracked funds (code, SFIN, name)
data/nav/<CODE>.csv                     date,nav — daily history, one row per NAV date
data/portfolio/<YYYYMM>.json            parsed monthly holdings / sectors / returns per fund
data/raw/daily-nav/<YYYYMMDD>.json      untouched upstream payloads, kept for reprocessing
data/raw/fund-details/<YYYYMM>.json
data/import/<CODE>.csv                  hand-exported backfill files (input to import_csv.py)
data/status.json                        last run, errors, latest feed dates, per-fund coverage, stale funds
```

## Running locally

Requires Python 3.10 or later. No `pip install` is needed.

```bash
python scripts/import_csv.py      # optional: merge any CSVs in data/import/
python scripts/fetch.py           # pull the latest NAVs and fact sheet
python scripts/build_site.py      # assemble _site/
python -m http.server -d _site    # open http://localhost:8000
```

## Backfilling NAV history

The public daily feed only carries the latest day, so older history has to be imported once by hand:

1. Open the [fund performance page](https://www.tataaia.com/customer-service/fund-performance.html).
2. Pick a fund, choose a custom range from **01/01/2023** (or earlier) to today, and click **Download CSV**.
3. Save the file as `data/import/<CODE>.csv`, using a code from [`funds.json`](funds.json), for example `WLE.csv`.
4. Commit and push. The fetch workflow merges it into `data/nav/<CODE>.csv`.

Imports are idempotent and the parser accepts common date formats. Isolated one-row glitches in the insurer's exports are dropped automatically and logged.

## Configuration

| Setting | Location | Default |
| --- | --- | --- |
| Analysis start date | `SINCE` in [`site/app.js`](site/app.js) | `2023-01-01` |
| Tracked funds | [`funds.json`](funds.json) | 18 funds |
| Fetch schedule | `cron` in [`fetch-data.yml`](.github/workflows/fetch-data.yml) | `30 20 * * *` (02:00 IST) |
| Staleness threshold | `STALE_AFTER_DAYS` in [`scripts/fetch.py`](scripts/fetch.py) | 4 days (covers a weekend plus a holiday) |

To track another fund, add its `code`, `sfin` and `name` to `funds.json`, then backfill its history.

## Operations and troubleshooting

- **Run health:** each fetch run writes a JSON summary to the Actions run page and to [`data/status.json`](data/status.json). Funds with no NAV in the last 4 days are listed under `stale_funds`.
- **Failure policy:** the job fails only when *both* feeds error. A single failed feed is recorded in `errors` and the run continues.
- **Upstream outage:** from August 2026 the public feeds stopped refreshing. As of 2026-11-16, `feed_nav_date` was still **2026-08-19** and the latest fact sheet was **June 2026**, because the backing service `sellonline.tataaia.com` showed a maintenance page. NAVs after that date came from CSV backfills. The nightly job resumes automatically once the feeds update.
- **Redeploy only:** run `pages.yml` manually from the Actions tab.

## Funds tracked

| Code | Fund | Code | Fund |
| --- | --- | --- | --- |
| WLF | Whole Life ST Fixed Income | MCF | Multi Cap |
| WLE | Whole Life Mid Cap Equity | ICF | India Consumption |
| WLS | Whole Life Stable Growth | EOF | Emerging Opportunities |
| TLC | Large Cap Equity | ESG | Sustainable Equity |
| WLA | Whole Life Aggressive Growth | DAF | Dynamic Advantage |
| WLI | Whole Life Income | FGF | Flexi Growth |
| TSS | Super Select Equity | SCF | Small Cap Discovery |
| ITF | Top 50 | RIF | Rising India |
| ITT | Top 200 | MIF | Midcap Momentum Index |

SFINs are listed in [`funds.json`](funds.json).

## Disclaimer

This is a personal tracking tool and **not investment advice**. Past performance does not guarantee future returns. Fund data is © Tata AIA Life Insurance Company Ltd and is reproduced here only for personal tracking.
