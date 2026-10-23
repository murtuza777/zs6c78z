# WindDesk engineering audit (2026-10-23)

Scope: full review of ingestion, domain logic, API, frontend, security, Docker and deployment.
Every finding below was reproduced against the real January 2026 snapshot or the running app
before being fixed, and each fix has a regression test unless noted.

**Baseline before the audit:** 129 backend and 23 frontend tests passing, lint clean.
Passing tests did not cover the defects below.

## 1. Issues found and fixed

### Critical
None. Cutoff-aware forecast selection was already correct: no forecast published after the
gate is ever selected. This is re-verified for 31 decisions × 36 gates on the real data.

### High

| # | Issue | Evidence | Fix | Regression test |
|---|---|---|---|---|
| H1 | **Look-ahead in the decision-time view.** The "typical error" tile and band under *Known at gate closure* were computed from all other January days, including later ones. | 648 of 744 pool rows for a 5 Jan decision came from later deliveries. | New `typical_error_known_at_gate` uses only delivery days that ended before the decision day. The all-other-days figure is labelled *pilot calibration*. | `test_decision_separates_known_at_gate_error_from_pilot_calibration`, page test |
| H2 | **Invalid daily energy P10–P90.** It was the sum of hourly quantiles, which is not a daily quantile. | Held-out daily coverage was 27/31 = 87% against a nominal 80%. | Quantiles of daily energy errors on other full-coverage days (LODO, ≥ 10 days). Hidden for partial days. Coverage is reported (74%). | `test_daily_energy_band_*`, `test_accuracy_reports_daily_energy_band_coverage` |
| H3 | **Ingestion could replace a good snapshot with incomplete or half-written data.** | Gaps only produced a warning, and files were written in place. | Completeness gate (`--allow-incomplete` to override, recorded in the manifest). Staged write, checksum round-trip, then atomic swap. | `tests/test_ingest_script.py` (5 tests) |
| H4 | **Unbounded caches keyed by user input.** Any HH:MM gate or date range could exhaust memory. | 60 custom gates left 61 cached frames. | Bounded LRU memos. | `test_caches_stay_bounded_under_many_custom_gates`, `test_memo_evicts_*` |
| H5 | **Cache stampede.** Concurrent first requests for one key all recomputed it; under the GIL this slowed every request. Found by the parallel e2e suite. | `/meta` took over 10 s; the e2e tests timed out. | Single-flight per key. | `test_concurrent_requests_for_one_key_compute_once` |
| H6 | **Vulnerable production dependencies.** | `npm audit --omit=dev`: react-router (high, open redirect) and echarts (moderate, XSS). | react-router-dom 7.18.4, echarts 6.1.0. Production audit is now 0. | `npm audit --omit=dev` |

### Medium

| # | Issue | Fix |
|---|---|---|
| M1 | 500 responses had no `X-Request-ID`, although the body asked users to quote it, and the exception log had no request ID | Middleware catches the exception, logs it with the ID, and returns a generic problem+json that carries the ID (test added) |
| M2 | Key-findings sentence was wrong when bias was negative (wrong direction word for the percentage) | States both shares and the direction of the balance (tests for positive and negative bias) |
| M3 | Partially forecast days were presented as full-day energy | `hours_expected`; "Partial: 22 of 24 h" warning; no daily range (API, unit and e2e tests) |
| M4 | A late run (12:25 filling the 11:30 slot) counted as available to gates before 12:25 | Availability follows the real `latest_publish_uk` (test) |
| M5 | Snapshot bytes and version differed between Windows (CRLF) and Linux | LF line endings. Snapshot regenerated: `jan2026-113afcef1a`, identical on Windows and in Docker (test) |
| M6 | Horizon slider committed only on pointer-up/key-up, then a race dropped keypresses (found by e2e) | `useDebouncedCommit` with a remembered last commit (hook test and e2e test) |
| M7 | Phones: legend overlapped the axis title, x-labels collided, and Accuracy overflowed horizontally (570 px in 375 px) | ECharts media queries, `hideOverlap`, `min-w-0` cards (e2e overflow tests on every route) |
| M8 | CSV: non-machine-readable UK times, no BOM, object URL revoked synchronously | `YYYY-MM-DD HH:MM` UK and UTC columns, BOM, delayed revoke; built by a pure `decisionCsv()` from the table's rows (unit and e2e tests) |
| M9 | Notebook re-run instructions referenced an uninstalled tool | `jupyter execute --inplace` (verified by re-executing the notebook) |

### Low

The following were fixed:

* **L1:** gate presets used `role=radio` without arrow-key behaviour; they now use `aria-pressed`.
* **L2:** no skip link or per-route document titles.
* **L3:** no metric explanations; every KPI tile now has an accessible InfoHint.
* **L4:** some information relied on colour alone. Actuals now have markers, and the vintage
  chart has a labelled "After gate" region.
* **L5:** no security headers or CSP, and an unvalidated client `X-Request-ID` was echoed back.
* **L6:** `uvicorn[standard]` extras were included in the serverless bundle.
* **L7:** the Methodology page hard-coded band thresholds; they now come from `/meta`.
* **L8:** a nonexistent DST gate time returned 500; it now returns 422.
* **L9:** the compose ingest mount was incompatible with atomic replace.
* **L10:** CI used deprecated Node 20 actions and had no typecheck or e2e job.
* **L11:** number formatters were re-created on every call.

## 2. Feature verification

Each item was tested in the running app (browser pane, desktop, 768 px and 375 px), in
automated tests, or both.

| Feature | Expected | How tested | Result |
|---|---|---|---|
| Decision date picker and stepping | Next/prev change D and D+1 together | e2e, browser | Pass |
| Gate presets and custom gate | Selected run follows the gate (09:50 → 09:30 run, 09:20 → 07:30, 15:30 → 15:30) | e2e, API tests | Pass |
| Delivery day, publish time, lead time | Correct UK times; 14.5–37.5 h at 09:50 | e2e, API tests | Pass |
| Energy, peak, minimum, known-at-gate error | Match API; no later-day data in decision-time figures | unit, API, browser | Pass |
| Daily and hourly P10–P90 | Valid method; coverage reported; hidden when unsupported | unit, API, browser | Pass |
| Reveal actuals | Hindsight tiles, line, post-gate runs and columns appear only when on; works by keyboard | unit, e2e | Pass |
| Revision history | Pre-gate runs always; post-gate runs only in hindsight; deltas over common hours | unit, browser | Pass |
| Hourly table and CSV | 24 rows; CSV rows equal table and API rows; BOM; filename | unit, e2e (real download) | Pass |
| Stale-feed and partial-day warnings | Shown with dates and counts | API, unit, e2e | Pass |
| Accuracy KPIs and findings | Consistent with API; correct for both bias signs | unit, e2e | Pass |
| Daily, histogram, hour, horizon, scatter and vintage charts | Render; tooltips; non-colour cues | builder unit tests, browser | Pass |
| Worst days → brief → back | Deep link opens hindsight; back returns | e2e | Pass |
| Date-range filtering | 5–12 Jan gives 192 expected hours; survives reload | e2e | Pass |
| Horizon Explorer | Lead-time rule enforced; slider commits | API, unit, e2e | Pass |
| Methodology | Matches implementation; thresholds from `/meta` | review, browser | Pass |
| Invalid params, 404, API errors | Safe defaults; in-app 404; error and retry | e2e | Pass |
| Responsive layout | No horizontal overflow at 375 px; readable charts | e2e (Pixel 7), browser | Pass |

## 3. Verification commands and results (final run)

| Check | Result |
|---|---|
| `uv run pytest` (backend) | **150 passed** |
| `ruff check`, `ruff format --check` | clean |
| requirements.txt vs uv.lock | in sync |
| `npm run lint`, `format:check`, `typecheck` | clean |
| `npm test` (Vitest) | **38 passed** (5 files) |
| `npm run build` | success |
| `npm run test:e2e` (Playwright, Chrome) | **15 passed** (11 desktop, 4 mobile), stable across repeated runs |
| GitHub Actions on `f0428c0` | backend, frontend, e2e, Docker: all passed |
| `pip-audit -r requirements.txt` | no known vulnerabilities |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Live re-ingestion (Windows and Docker) | byte-identical to the committed snapshot |
| `docker compose up --build` (clean) | healthy, non-root (uid 10001), all endpoints correct, CSP present, traversal probes return 404 or the SPA, never files |
| Production https://zs6c78z.vercel.app (anonymous) | UI routes 200; API 200/422/404 as expected; snapshot `jan2026-113afcef1a`; security headers; ETag and 304 |

## 4. Remaining known issues

* **Dev-only advisories:** esbuild under the Vite 5 dev server, Vitest 2 and tinypool, and
  Tailwind 3's postcss-selector-parser. None ship to production; fixing them needs major
  upgrades (Vite 6+, Vitest 3+, Tailwind 4).
* **Pilot calibration:** bands use leave-one-day-out, which includes days after each decision.
  This is labelled in the UI. A trailing-only band would be empty for early January, because
  data outside the scope is not used.
* **Domain assumptions** (documented): `publishTime` is taken as availability time, the
  delivery day is 00:00–24:00 UK, and the hourly-mean alignment is assumed (WINDFOR semantics
  are undocumented).
* **Chart data for screen readers:** the Brief has a full table. The Accuracy charts rely on
  aria labels, tooltips, the worst-days table and the API; per-chart data tables are a
  follow-up.
* **Bundle size:** ECharts 6 is about 213 KB gzipped and is needed on three of the four
  routes.
* **Deployment:** Vercel is deployed from the CLI. The GitHub ↔ Vercel integration is not
  connected (it needs the Vercel GitHub app on the account).
