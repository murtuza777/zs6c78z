# Gridbricks Full-Stack Challenge: Build Plan

> Working name: **WindDesk** (repo name will be an anonymous random string, e.g. `qz7kv3`)
> Budget: 16 h max. Evaluation starts with the **video**, so every phase serves the demo story.

---

## 1. What the client actually needs

The client is a UK utility. Its day-ahead trading desk must decide, on day **D-1** before the auction closes, how much power to buy for delivery day **D**. Wind output is uncertain, so whatever wind does not cover has to be bought elsewhere (for example from thermal plants).

The app has two jobs:

| # | Job | What the app shows |
|---|-----|--------------------|
| 1 | "What did the latest forecast say when I had to decide?" | For each January 2026 decision day: the **latest WINDFOR forecast published before gate closure**, covering the next delivery day. |
| 2 | "How much can I trust it?" | **Quantified error**: MAE, RMSE, bias, error percentiles, error by horizon and hour of day, plus an **uncertainty band (P10–P90)** around each forecast. |

Scope: Elexon **FUELHH (WIND)** actuals and **WINDFOR** forecasts only. Only the data needed for **decisions made 1–31 Jan 2026** is used, which means delivery days **2 Jan – 1 Feb 2026**.

---

## 2. Data facts (checked against the live API on 2026-10-23)

| | FUELHH (actuals) | WINDFOR (forecasts) |
|---|---|---|
| Endpoint | `/datasets/FUELHH/stream?settlementDateFrom&settlementDateTo&fuelType=WIND` | `/datasets/WINDFOR/stream?publishDateTimeFrom&publishDateTimeTo` |
| Resolution | 30 min (`startTime`, UTC) | **1 hour** (`startTime` on the hour) |
| Cadence | 1 value per settlement period | **8 publishes/day**: 02:30, 04:30, 07:30, **09:30**, 11:30, 15:30, 18:30, 22:30 UTC |
| Coverage per pull | 1 Jan–2 Feb: 1,584 rows, **no gaps, no duplicates** | Each publish has 73 hourly points from about D-1 21:00 to D+2 21:00 |
| Range | 1,695–17,805 MW (mean ≈ 11.4 GW) | Includes **past target times** (negative horizon), which must be filtered out |

January is GMT, so UK local time equals UTC. The code still converts through `Europe/London` so it stays correct across daylight-saving changes.

### Market timing (drives the "latest forecast" definition)
- **N2EX (Nord Pool) GB day-ahead auction**: gate closure **09:50 UK time** on D-1, results by about 10:00. With this gate, the latest usable forecast is the **09:30** publish.
- **EPEX GB hourly auction**: closes around 09:20 UK time. The latest usable forecast is then the **07:30** publish.
- The app makes the gate a **setting** (preset N2EX 09:50 / EPEX 09:20 / custom). The client can then see the trade-off between waiting for a fresher forecast and closing earlier.
- From a 09:30 forecast, delivery day D (00:00–23:00) is forecast **14.5 h to 37.5 h ahead**.

### Assumptions to state on the Methodology page and in the README
1. Delivery day = UK settlement day 00:00–24:00 local time (48 settlement periods).
2. Forecast and actual are compared at the **hourly forecast timestamps**. The actual value is the half-hour starting at that `startTime` (the brief says the two `startTime` fields are "similar"). The notebook checks how sensitive results are to using the hourly mean instead.
3. Both datasets cover metered wind only, not embedded wind. The notebook will check this by comparing their levels.
4. A forecast counts as "available at decision time" only if `publishTime <= gate closure`. No forecast published after the gate is ever used (**no look-ahead**).

---

## 3. Core logic (the part a tech lead will scrutinise)

```
decision_date d, gate g (UK local)
cutoff_utc      = to_utc(d + g)
delivery_window = [d+1 00:00, d+2 00:00) UK local -> UTC
F = WINDFOR where publishTime <= cutoff_utc and startTime in delivery_window
    and startTime > publishTime                         # drop past points
    -> keep latest publishTime per startTime            # the "latest forecast"
A = FUELHH WIND at the same startTime
error = forecast - actual   (positive = over-forecast = you under-bought)
```

**Horizon explorer** (generic view): for each target time `t`, use the latest forecast with `publishTime <= t - H` (slider for H from 0 to 48 h).

**Metrics**: MAE, RMSE, mean bias, WAPE (= Σ|e| / Σ actual; we avoid MAPE because it blows up when wind is low), absolute-error percentiles P50/P90/P95/P99, maximum error, correlation, daily energy error (MWh). Every metric is also broken down **by horizon bucket**, **by hour of day** and **by forecast vintage** (07:30 vs 09:30 vs 11:30).

**Uncertainty band**: take the empirical quantiles of `actual - forecast` within each horizon bucket. They are computed **leave-one-day-out**, so a day's own error never feeds its own band. The band is forecast + q10/q90, clipped at 0. The accuracy page reports the band's **empirical coverage**, which should be about 80%. This shows the band is calibrated rather than decorative.

**What the desk takes away**: "Wind you can count on at P90" = the P10 band (lower edge) per hour and as daily energy. The gap between the P50 and P90 cases is the extra volume to cover if they want 90% confidence.

---

## 4. Product: screens

1. **Day-Ahead Brief** (landing page). Pick a decision date (1–31 Jan) and a gate preset.
   - KPI cards: forecast energy for D (GWh), P90-reliable wind energy, peak and trough MW, typical error at this horizon.
   - Main chart: latest forecast line, P10–P90 band and earlier vintages as faded lines (to show forecast revisions), with a **"Reveal actual"** toggle. The toggle splits what you knew at the gate from what actually happened, which is a strong moment for the demo.
   - Hourly table with CSV export.
2. **Forecast Accuracy** (for the chosen period and gate).
   - Headline KPIs.
   - Charts: error by horizon (line), error by hour of day (bars), error histogram, forecast-vs-actual scatter, daily MAE timeline or calendar heatmap, vintage comparison.
   - **Worst 5 days** list. Clicking a day opens it in the Day-Ahead Brief.
3. **Horizon Explorer**. Date range plus horizon slider; actual and forecast lines with brush zoom. This is the classic view.
4. **Methodology**. Definitions, assumptions and data sources, written for a trader.

Client-side state worth showing off: URL holds all state (shareable links), cross-navigation from worst days to the brief, synced zoom/brush, server state cached in TanStack Query.

---

## 5. Architecture

```
            ┌───────────── Elexon BMRS API ─────────────┐
            │  FUELHH (WIND)            WINDFOR          │
            └──────────────┬────────────────────────────┘
                           │ scripts/ingest.py (async httpx, retry/backoff, chunked by day)
                           ▼
              data/snapshot/*.csv.gz + manifest.json   (validated, versioned, reproducible)
                           │ loaded once at startup
                           ▼
 ┌──────────────── FastAPI (Python 3.12) ────────────────┐
 │ api/v1 routers -> domain (pure functions) -> repository │
 │ alignment.py  metrics.py  uncertainty.py  market.py    │
 │ pydantic schemas · problem+json errors · Cache-Control │
 │ JSON logs · request-id · timing middleware · /health   │
 └───────────────────────┬────────────────────────────────┘
                         │ /api/v1/* (OpenAPI at /api/docs)
                         ▼
 ┌──────────── React 18 + TypeScript + Vite ─────────────┐
 │ TanStack Query · URL-state · ECharts · Tailwind        │
 └────────────────────────────────────────────────────────┘
```

**Why a snapshot instead of calling Elexon live?** January 2026 is fixed history. A validated snapshot makes the deployed app fast, deterministic and independent of Elexon rate limits or outages, and its results can be reproduced. The ingest script regenerates it in one command. `DATA_MODE=live` is left as an extension point.

### API (versioned, built to age well)
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | liveness + snapshot version |
| `GET /api/v1/meta` | date bounds, publish schedule, gate presets, units |
| `GET /api/v1/decisions/{date}?gate=09:50` | latest forecast, band, vintages and actuals for delivery day D |
| `GET /api/v1/accuracy?from&to&gate` | summary metrics + breakdowns + worst days |
| `GET /api/v1/horizon?from&to&horizon_h` | aligned actual/forecast series |

Conventions: timestamps in ISO-8601 UTC, explicit units (`MW`, `MWh`), query parameters validated by pydantic, errors returned as `application/problem+json`, and long `Cache-Control` headers because the history never changes.

### Tech choices
- **Backend**: FastAPI, httpx (async), pandas/numpy, pydantic-settings. Dependencies managed with `uv`. No pyarrow, to stay under Vercel's function size limit.
- **Frontend**: React + TS + Vite, TanStack Query, React Router (URL state), Apache ECharts (fast with time series, has bands and brush zoom), Tailwind.
- **Quality**: ruff + mypy, eslint + prettier, pre-commit, conventional commits, small focused commits.
- **Tests**:
  - pytest unit tests for alignment edge cases: forecast after cutoff excluded, negative horizons dropped, duplicate publishes, missing actuals, DST boundary, empty windows.
  - Metrics tested against hand-computed values; uncertainty band checked for coverage.
  - API tests with a fixture snapshot, plus a contract test against a recorded Elexon response.
  - vitest + Testing Library for key components; one Playwright smoke test if time allows.
- **CI**: GitHub Actions running lint, type-check, tests (backend and frontend) and a Docker build.
- **Docker**: a multi-stage `Dockerfile` (Node build stage, then a slim Python runtime that serves both API and static UI); `docker-compose.yml` for dev with hot reload.
- **Deploy**: **Vercel** (recommended: free, no dyno sleep). The React build ships as static files and FastAPI runs as a Python function (`api/index.py`) with the snapshot bundled. Heroku is the fallback, but its Eco dynos cost about $5/month and sleep when idle.

### Repo layout
```
<random-name>/
├── backend/
│   ├── app/{main.py, config.py, observability.py}
│   ├── app/api/v1/          # routers
│   ├── app/schemas/         # pydantic response models
│   ├── app/domain/          # alignment, metrics, uncertainty, market (pure, tested)
│   ├── app/data/            # elexon_client, repository
│   ├── scripts/ingest.py
│   ├── data/snapshot/
│   └── tests/
├── frontend/src/{pages,components/charts,hooks,api,lib}
├── analysis/forecast_error_analysis.ipynb
├── api/index.py             # Vercel entrypoint
├── docs/{architecture.md, decisions/ (ADRs)}
├── Dockerfile · docker-compose.yml · vercel.json · Makefile
├── .github/workflows/ci.yml
└── README.md                # files and dirs, how to run, live link, AI-tools disclosure
```

---

## 6. Phased timeline (about 15 h, leaving a buffer)

| Phase | Hours | Output | Done when |
|---|---|---|---|
| 0. Scaffold | 0.5 | git repo, tooling, CI skeleton, Makefile | `make lint test` runs green |
| 1. Ingest + snapshot | 1.5 | `ingest.py`, snapshot, data-validation report | gaps/dupes/schedule checked and logged |
| 2. Domain logic + tests | 2.5 | alignment, metrics, uncertainty, market timing | edge-case tests pass; numbers spot-checked by hand |
| 3. API | 1.5 | v1 endpoints, schemas, API tests, OpenAPI | `/api/docs` complete; tests green |
| 4. Frontend | 4.0 | 4 screens, charts, URL state | full demo flow works locally |
| 5. Analysis notebook | 1.0 | error deep-dive and insights used in the pitch | runs top to bottom from the snapshot |
| 6. Docker + deploy | 1.5 | Dockerfile, compose, Vercel deploy | live URL opens in incognito |
| 7. Docs | 1.0 | README, architecture.md, ADRs, AI disclosure | README covers all 3 required items |
| 8. Video | 1.5 | scripts, recording, unlisted YouTube upload | ≤10 min; plays in incognito |

---

## 7. Video plan (≤10 min total)

**Part 1: client pitch (≤5 min)**
1. *Hook (0:30)*: "Every morning before 09:50 your desk commits volumes for tomorrow. In January, wind swung between 1.7 and 17.8 GW, and that swing is your risk."
2. *Day-Ahead Brief (1:30)*: pick a volatile day, show what the 09:30 forecast said, show the band and the reliable wind figure, then reveal the actual.
3. *Accuracy (1:30)*: headline MAE and bias, how error grows with horizon, which hours are worst, worst days, and band coverage near 80% ("you can trust the band").
4. *Decision value (1:00)*: "At P90 confidence, plan for about X MW less wind than the central forecast." Also: whether waiting for a later forecast is worth it (09:20 gate vs 09:50).
5. *Next steps (0:30)*: production roadmap (live feed, embedded solar and wind, demand, alerts).

**Part 2: tech-lead review (≤5 min)**
1. Architecture diagram and data flow (0:45).
2. Key definitions and the **no-look-ahead** guarantee, with the test that proves it (1:00).
3. Code tour: pure domain layer, then API, then frontend state and data fetching (1:30).
4. Engineering practices: tests, CI, Docker, logging and request-ids, ADRs (1:00).
5. Trade-offs and next steps: snapshot vs live, hourly alignment choice, leave-one-day-out band (0:45).

Recording: OBS or Loom at 1080p, then upload to YouTube as **Unlisted**.

---

## 8. Submission checklist
- [ ] Public GitHub repo with an **anonymous random name**
- [ ] README: file/dir guide, how to run (Docker and local), live link, **AI tools used (Claude Code)**
- [ ] Vercel app live; open it in **incognito**
- [ ] YouTube video set to **Unlisted**; open it in **incognito**
- [ ] Repo URL opens in **incognito**
- [ ] Submit the Microsoft Form with all links

## 9. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Elexon API slow or down | Validated snapshot committed to the repo; ingest retries with backoff |
| Vercel Python bundle too large | pandas + numpy only, no pyarrow; CSV.gz snapshot |
| Look-ahead leakage | Strict `publishTime <= cutoff` check, covered by a dedicated test |
| Timezone bugs | Store everything in UTC; convert at the edge with `Europe/London`; DST test |
| Overrunning 16 h | Ship the core screens first; vintages, Playwright and heatmap are optional |

## 10. Who does what
- **Claude**: all code, tests, Docker, CI, docs, notebook, deploy config, video scripts, incognito link checks.
- **You**: `gh auth login` (GitHub), Vercel login, recording and uploading the video, submitting the form.
