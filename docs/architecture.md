# WindDesk architecture and design notes

This document is for a technical reviewer. It covers how data flows, where each
responsibility lives, the decisions behind the design, and what would change in production.

## 1. Data flow

```
Elexon BMRS ──httpx──▶ ingest.py ──validate──▶ snapshot (CSV.gz + manifest, sha256)
                                                   │  loaded once per process
                                                   ▼
React (TanStack Query) ──/api/v1──▶ FastAPI routes ──▶ AnalyticsService ──▶ domain/*
```

1. **Ingestion** (`backend/scripts/ingest.py`). `ingestion_window()` derives the minimal
   windows from the decision scope: FUELHH by settlement date for delivery days 2 Jan–1 Feb;
   WINDFOR by publish time from 72 h before the first delivery period (runs reach about 66 h
   ahead) to the end of 31 Jan. `ElexonClient` retries 429/5xx/timeouts with exponential
   backoff and honours `Retry-After`. Any other failure raises `ElexonError` with the URL, the
   parameters and a snippet of the response body.
2. **Validation** (`app/data/validation.py`). Structural problems fail the run. Row-level
   problems are removed and counted. Gaps are listed in the manifest and **never imputed**.
   Conflicting duplicate actuals keep the latest revision. Settlement period and date are
   cross-checked against the start time.
3. **Snapshot** (`app/data/snapshot.py`). gzip with `mtime=0` gives byte-identical output for
   identical data, so the sha256 checksums in `manifest.json` are reproducible. The loader
   re-verifies checksums, row counts and uniqueness, and refuses to serve a corrupt snapshot.
4. **Service** (`app/services.py`). Loads the snapshot once, lazily and thread-safely, which
   also works on serverless runtimes that skip ASGI lifespan events. It memoises per gate the
   alignment of all 31 decisions, the error pool for the bands, the vintage comparison and the
   band coverage. The data is immutable, so there is nothing to invalidate.
5. **API** (`app/api`). Thin handlers; `RequestError` → 422 problem+json; `SnapshotError` → 503.
6. **Frontend.** URL search params are the single source of view state. TanStack Query caches
   with `staleTime: Infinity` and keeps the previous data shown, dimmed, while a new request
   loads (no skeleton flash). ECharts options come from pure builder functions, which the tests
   cover.

## 2. Module responsibilities

| Module | Responsibility | Depends on |
|---|---|---|
| `domain/market.py` | scope constants, gate presets with sources, Europe/London ↔ UTC, delivery windows, DST policy | stdlib, pandas |
| `domain/alignment.py` | hourly aggregation of actuals, cutoff and horizon selection, alignment | pandas |
| `domain/metrics.py` | `Metrics` dataclass and `summarize()`, histogram | numpy, pandas |
| `domain/uncertainty.py` | lead-time buckets, leave-one-day-out quantiles, band, coverage | numpy, pandas |
| `domain/reports.py` | breakdowns, vintage comparison, revision history, stale-feed detection, horizon view | the above |
| `services.py` | validation of scope, caching, assembly of response dicts | domain, snapshot |
| `api/*`, `schemas/*` | HTTP contract only | services |

The domain layer has no I/O and no framework imports, so tests can exercise it with small
synthetic frames (`tests/factories.py`).

## 3. Key decisions

| Decision | Why | Trade-off |
|---|---|---|
| Serve a committed, checksummed snapshot | History is immutable; the demo must not depend on Elexon uptime or rate limits; results are reproducible | Needs a re-ingest to extend scope (one command) |
| `publishTime ≤ cutoff` **and** `startTime > publishTime` | The brief defines `publishTime` as creation time; runs repeat past hours that are not forecasts | If real availability lags `publishTime`, model the lag with a custom gate |
| Latest eligible run **per target hour** | Correct if a newer run omits some hours (falls back hour by hour) | Several publish times can feed one day; the UI shows this |
| Hourly mean of two half-hours as the primary actual | Compares like with like at the forecast's resolution; partial hours are excluded, not estimated | WINDFOR semantics undocumented; the first-half-hour sensitivity check changes MAE by under 1% |
| Gate presets as documented scenarios + custom | Exchange rules differ and change; sources are shown in the UI and API | None |
| Leave-one-day-out empirical band by 6 h lead-time bucket, with a minimum sample | A day's own errors never shape its band; thin buckets show no band instead of a misleading one | One month and autocorrelated errors: coverage is reported (76.7% vs 80%); LODO uses later days, so it is labelled pilot calibration |
| Separate *known at gate* error (completed days only) | Decision-time tiles must not use information from after the decision | Few days early in the month (none on 1 Jan); shown next to the pilot figure |
| Daily energy range from daily error quantiles | Hourly quantiles do not add up to a daily quantile; summing them over-covered (87% of days) | Needs ≥ 10 fully forecast days; hidden for partial days |
| Bounded, single-flight LRU memos | Keys come from user input (any gate or range); concurrent first requests must not stampede | Duplicate keys wait for the first computation |
| Staged, verified, atomic snapshot publish + completeness gate | Failed or incomplete ingestion must never replace a good snapshot | `--allow-incomplete` needed to keep gaps deliberately |
| LF line endings and `mtime=0` gzip | Same data gives byte-identical snapshots on every platform | — |
| WAPE instead of MAPE | MAPE explodes at low wind | — |
| Numeric x-axis with UK-local tick formatter | Ticks land on UK hours in any browser time zone (ECharts time axes use the browser's zone) | Band drawn as a custom polygon (line stacking needs a category or time axis) |
| Single Vercel deployment (static + Python function) | One URL, CDN edge caching via `s-maxage`, no dyno sleep | Cold start of about 1 s; pandas fits the function size limit |
| Docker image = API + built UI in one container | One-command local run that mirrors production; non-root, healthcheck | — |

## 4. Look-ahead guarantees

* `select_latest_at_cutoff` is the only path for decision-time forecasts and filters on
  `publish_time <= cutoff`.
* `tests/test_real_snapshot.py` asserts, for 36 gate times × 31 decisions on the real data,
  that every selected forecast was published at or before the cutoff and strictly before its
  target, and that the target lies inside the delivery window.
* The frontend never draws actuals or runs published after the gate unless *Reveal actuals* is
  on. `charts.test.ts` checks this.

## 5. Observability and operations

* JSON logs with `request_id`, method, path, status and `duration_ms`. `X-Request-ID` is echoed
  and included in 500 problem bodies. `Server-Timing` header.
* `/api/v1/health` reports the snapshot version and row counts (`Cache-Control: no-store`).
* Weak ETags are keyed by snapshot version and URL, so a new snapshot invalidates every cache.

## 6. Performance (measured locally)

First `/accuracy` call about 0.36 s (it aligns all 31 decisions, the vintage grid and the LODO
coverage), about 0.12 s once memoised. `/decisions` takes about 35 ms when warm. Payloads are
gzipped (`/accuracy` about 16 KB over the wire). Memo keys are single-flight: the parallel e2e
suite exposed a stampede where several workers recomputed the same gate at once and pushed
`/meta` past 10 s; this is now fixed and covered by a concurrency test. The frontend bundle is
about 300 KB gzipped (ECharts 6 is about 213 KB of that and is needed on three of four routes).

## 7. What changes for production

* Scheduled incremental ingestion into a store (e.g. Postgres/Parquet partitioned by run), with
  alerts on late, missing or **repeated** runs (the 26–27 Jan stale streak).
* Bias correction and calibrated quantile models trained on longer history; evaluation in
  backtests.
* Net-position view: demand forecast, embedded solar and wind, contracted volumes, prices.
* AuthN/Z, audit log of what was shown at decision time, SLOs on the API.
