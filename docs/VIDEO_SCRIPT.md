# Demo video script (10 minutes, unlisted YouTube)

Record at 1080p, browser full screen at https://zs6c78z.vercel.app. Every number below comes
from the live app or the notebook, so say only what is on screen.

---

## Part 1: client presentation (≤ 5:00)

**0:00–0:35. The problem.** *Screen: Day-Ahead Brief, `?date=2026-01-27&gate=09:50`, actuals hidden.*
> "Every morning your desk commits tomorrow's volumes in the day-ahead auction, before 09:50 on
> N2EX. Whatever wind doesn't deliver, you buy elsewhere. In January, national wind swung
> between about 1.7 and 17.8 GW. WindDesk answers two questions: what did the forecast say
> when you had to decide, and how far can you trust it?"

**0:35–1:50. The Day-Ahead Brief, decision-time view.**
* Point to the headline card: decision 27 Jan at 09:50 → delivery 28 Jan; the 09:30 run was
  the latest available; lead time 14.5–37.5 h.
* Switch gate presets (09:20 EPEX → 07:30 run; 15:30 → 15:30 run). "Gates are scenarios with
  sources. You can model your own cutoff."
* Headline: "At 09:50 the latest forecast, published 09:30, expected 267 GWh for 28 Jan."
  Tiles: daily P10–P90 183–267 GWh, peak 15.2 GW, and the *typical error known at the
  gate*: 1.9 GW from the 25 January days already completed. "No hindsight: only days
  that had finished count." Hover an ⓘ to show the metric explanations.
* Point to the **stale-feed warning**: values unchanged since 26 Jan 18:30, five repeated runs.
  "The feed had not updated for 15 hours. WindDesk flags it."

**1:50–2:50. What to buy, then what happened.** In the what-if, type 30,000 MW (or click
*Try 30,000 MW*).
> "If wind arrives as forecast you buy 452.8 GWh. To be covered on a low-wind day you buy
> 542.0 GWh: 89.2 GWh of extra cover, which is what the uncertainty costs you."

*Toggle Reveal actuals.*
> "Actual wind was 138 GWh, about half the forecast. The forecast plan was 129 GWh short, and
> even the cautious plan was 39.8 GWh short. The violet lines are runs published after the gate:
> the 11:30 run already cut 57 GWh. This was January's worst day." Show the CSV export.

**2:50–4:15. Forecast Accuracy.** *Open the Accuracy tab.*
* Timeline: the forecast available at the gate vs actual for every January hour. "The cyan line
  sits above the amber one almost all month." 
* Key findings: forecast **above actual in 84% of hours**, bias **+1,730 MW**, MAE 2,013 MW,
  1,287 GWh over-forecast across the month.
* "So the error is mostly systematic. Planning on the raw forecast overstated wind supply and
  left you short."
* Daily chart: click 28 Jan to jump back to the brief. Histogram (mostly red, over-forecast),
  scatter above the diagonal.
* Vintage chart: "Waiting for the 22:30 run is about 9% better, but it comes after the gate.
  Correcting the bias is worth far more than waiting."
* Band check: hourly band 76.7% and daily range 74% held-out coverage against 80% nominal.
  "Close to calibrated; we report it rather than assume it."

**4:15–5:00. Limits and next steps.**
> "This pilot uses national wind data only. It is decision support, not procurement error:
> demand, prices and curtailment are not in this data. Next: live ingestion with stale-feed
> alerts, a bias-corrected forecast, and a net-position view with your demand and contracts."

---

## Part 2: technical review (≤ 5:00)

**5:00–5:50. Architecture.** *Screen: README architecture diagram.*
> "Elexon → an httpx ingestion script with retries → validation → a checksummed CSV.gz snapshot
> with a manifest. FastAPI loads it once; a pure pandas domain layer does selection, alignment,
> metrics and bands. React with TanStack Query and ECharts. A single Vercel deployment: CDN for
> the UI, a Python function for the API."
Show `backend/data/snapshot/manifest.json` (scope, validation report, sha256).

**5:50–6:50. Cutoff-aware selection.** *Screen: `backend/app/domain/alignment.py`.*
* Walk through `select_latest_at_cutoff`: `publish_time <= cutoff`, `start_time > publish_time`,
  latest run per target hour.
* `market.py`: Europe/London → UTC, 23/25 h days, ambiguous and nonexistent times.
* Hourly mean of two half-hours, partial hours excluded, never estimated.

**6:50–7:40. Tests that prevent look-ahead.** *Screen: `tests/test_real_snapshot.py`, then run:*
```bash
cd backend && uv run pytest -q
```
> "36 gate times by 31 decisions on the real data: nothing published after the cutoff is ever
> selected. Also hand-computed metrics, DST, duplicates, gaps, ingestion safety: 150 backend tests."
Then `cd frontend && npm test` (38 tests, including "actuals are never drawn before Reveal")
and `npm run test:e2e` (15 Playwright tests in real Chrome, desktop and mobile).

**7:40–8:30. API and frontend structure.**
* Open `/api/docs`: five endpoints, problem+json error on `/decisions/2026-02-01`, ETag/304.
* `services.py` per-gate memoisation; `frontend/src/components/charts/decisionChart.ts` pure
  option builder; URL state (`?date&gate&reveal`) makes every view shareable.

**8:30–9:15. Docker, CI, deployment.**
```bash
docker compose up --build
```
Show http://localhost:8000. Show `.github/workflows/ci.yml` (lint, tests, Docker smoke test) and
`vercel.json`.

**9:15–10:00. Trade-offs.**
> "Snapshot instead of live calls: deterministic and resilient, with one command to refresh.
> publishTime is taken as availability, and a custom gate models any lag. Leave-one-day-out
> bands with a minimum sample, and coverage reported honestly. Next: live ingestion, bias
> correction, longer history."

---

## Recording and upload steps (manual)

1. Record with OBS Studio or Loom (screen + mic), 1080p, maximum 10:00. Two takes, one per part,
   are fine; trim and join them.
2. YouTube → **Create → Upload video** → select the file → visibility **Unlisted** → Save.
3. Copy the link and open it in an **incognito window** to confirm it plays without signing in.
4. Also open the repo and the live app in incognito, then submit all three links in the
   Microsoft Form.
