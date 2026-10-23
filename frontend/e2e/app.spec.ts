import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

const brief = '/brief?date=2026-01-27&gate=09:50';

async function headline(page: Page) {
  const text = page.getByText(/^At \d\d:\d\d UK on/);
  await expect(text).toBeVisible();
  return text;
}

test.describe('Day-Ahead Brief', () => {
  test('deep link shows the forecast available at the gate, hiding actuals until revealed', async ({
    page,
  }) => {
    await page.goto(brief);
    const line = await headline(page);
    await expect(line).toContainText('09:50 UK on Tue 27 Jan 2026');
    await expect(line).toContainText('published Tue 27 Jan 09:30 UK');
    await expect(line).toContainText('Wed 28 Jan 2026');
    await expect(page.getByText('Actuals are hidden')).toBeVisible();
    await expect(page.getByText('What actually happened')).toHaveCount(0);
    await expect(
      page.getByText(/Stale feed: values unchanged since Mon 26 Jan 18:30 UK/),
    ).toBeVisible();

    // Keyboard: focus the switch and toggle it with Space.
    await page.getByRole('switch', { name: 'Reveal actuals' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('What actually happened')).toBeVisible();
    await expect(page).toHaveURL(/reveal=1/);
    await expect(page.getByText('+129.0 GWh')).toBeVisible();
  });

  test('gate presets change which forecast run is selected', async ({ page }) => {
    await page.goto(brief);
    await page.getByRole('button', { name: /09:20/ }).click();
    await expect(page).toHaveURL(/gate=09%3A20|gate=09:20/);
    await expect(await headline(page)).toContainText('published Tue 27 Jan 07:30 UK');
    await page.getByRole('button', { name: /15:30/ }).click();
    await expect(await headline(page)).toContainText('published Tue 27 Jan 15:30 UK');
  });

  test('date stepping moves decision and delivery days together', async ({ page }) => {
    await page.goto(brief);
    await page.getByRole('button', { name: 'Next decision day' }).click();
    await expect(page).toHaveURL(/date=2026-01-28/);
    const line = await headline(page);
    await expect(line).toContainText('Wed 28 Jan 2026');
    await expect(line).toContainText('Thu 29 Jan 2026');
  });

  test('CSV export matches the hourly table', async ({ page }) => {
    await page.goto(`${brief}&reveal=1`);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /export hourly observations as csv/i }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(
      'winddesk_decision_2026-01-27_gate-0950_with-actuals.csv',
    );
    const text = await readFile((await download.path())!, 'utf-8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(25);
    expect(lines[0]).toContain('start_time_uk');
    expect(lines[1]).toContain('2026-01-28T00:00:00Z,2026-01-28 00:00,');
    const rows = page.locator('table').last().locator('tbody tr');
    await expect(rows).toHaveCount(24);
  });

  test('a gate before the first run shows a partial day, not a full one', async ({ page }) => {
    await page.goto('/brief?date=2026-01-01&gate=00:00');
    await expect(page.getByText('Partial: 22 of 24 h forecast')).toBeVisible();
    await expect(page.getByText('No completed January days yet', { exact: false })).toBeVisible();
  });

  test('invalid URL parameters fall back to safe defaults', async ({ page }) => {
    await page.goto('/brief?date=2030-01-01&gate=99:99');
    const line = await headline(page);
    await expect(line).toContainText('09:50 UK on Sat 31 Jan 2026'); // latest decision
  });

  test('API failures show an actionable error that can be retried', async ({ page }) => {
    await page.route('**/api/v1/decisions/**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Unavailable', status: 503, detail: 'Snapshot offline' }),
      }),
    );
    await page.goto(brief);
    await expect(page.getByRole('alert')).toContainText('Snapshot offline');
    await page.unroute('**/api/v1/decisions/**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await headline(page);
  });
});

test.describe('Landing and procurement what-if', () => {
  test('the app opens on the latest decision, with history known at the gate', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/brief/);
    const line = await headline(page);
    await expect(line).toContainText('09:50 UK on Sat 31 Jan 2026');
    await expect(page.getByText(/On the 29 January delivery days completed/)).toBeVisible();
  });

  test('typing a demand shows how much to buy, kept in the URL and in hindsight', async ({
    page,
  }) => {
    await page.goto(brief);
    await page.getByLabel('Your demand, MW (flat across the day)').fill('30000');
    await expect(page).toHaveURL(/demand=30000/);
    // 24 h x 30,000 MW = 720 GWh demand; forecast wind 267.2 GWh
    await expect(page.getByText('452.8 GWh')).toBeVisible();
    await page.reload();
    await expect(page.getByText('452.8 GWh')).toBeVisible();
    await page.getByRole('switch', { name: 'Reveal actuals' }).click();
    // The forecast plan's shortfall equals the day's energy error (+129.0 GWh).
    await expect(page.getByText(/forecast plan short by 129\.0 GWh/)).toBeVisible();
  });

  test('the example button and CSV include the plan', async ({ page }) => {
    await page.goto(brief);
    await page.getByRole('button', { name: /example demand/i }).click();
    await expect(page).toHaveURL(/demand=30000/);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /export hourly observations as csv/i }).click();
    const text = await readFile((await (await downloading).path())!, 'utf-8');
    const [header, first] = text.slice(1).split('\r\n');
    expect(header).toContain('buy_if_forecast_mw');
    const cols = header!.split(',');
    const values = first!.split(',');
    const forecast = Number(values[cols.indexOf('forecast_mw')]);
    expect(Number(values[cols.indexOf('buy_if_forecast_mw')])).toBe(30000 - forecast);
  });
});

test.describe('Forecast Accuracy', () => {
  test('January timeline plots the gate-time forecast for every hour', async ({ page }) => {
    await page.goto('/accuracy?gate=09:50');
    await expect(
      page.getByRole('img', {
        name: /forecast available at 09:50 and actual wind generation, 744 hours/,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: /09:20/ }).click();
    await expect(
      page.getByRole('img', {
        name: /forecast available at 09:20 and actual wind generation, 744 hours/,
      }),
    ).toBeVisible();
  });

  test('worst-day link opens the brief in hindsight mode and back returns', async ({ page }) => {
    await page.goto('/accuracy?gate=09:50');
    await expect(page.getByText(/above actual output in 84% of hours/)).toBeVisible();
    await page
      .getByRole('link', { name: /Open brief/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/brief\?date=2026-01-27&gate=09:50&reveal=1/);
    await expect(page.getByText('What actually happened')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/accuracy/);
    await expect(page.getByText('Worst five delivery days')).toBeVisible();
  });

  test('date-range deep links survive a reload (SPA fallback)', async ({ page }) => {
    await page.goto('/accuracy?from=2026-01-05&to=2026-01-12');
    await expect(page.getByText(/Key findings, 5 Jan to 12 Jan decisions/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Key findings, 5 Jan to 12 Jan decisions/)).toBeVisible();
    await expect(page.getByText(/^\d+\/192$/)).toBeVisible(); // 8 decisions x 24 hours
  });
});

test.describe('Horizon Explorer', () => {
  test('keyboard changes to the lead-time slider are committed to the URL', async ({ page }) => {
    await page.goto('/horizon?h=24');
    const slider = page.getByRole('slider');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/h=27/);
    await expect(page.getByText(/publishTime <= T - 27 h/)).toBeVisible();
  });
});

test('unknown routes render the in-app not-found page', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByText('No page at /does-not-exist')).toBeVisible();
  await expect(page).toHaveTitle('Page not found · WindDesk');
});

test.describe('responsive layout @mobile', () => {
  for (const path of [
    '/brief?date=2026-01-27&reveal=1&demand=30000',
    '/accuracy',
    '/horizon',
    '/methodology',
  ]) {
    test(`no horizontal page overflow on ${path} @mobile`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test('Accuracy still renders if the API response predates the timeline', async ({ page }) => {
  // Regression: a browser-cached pre-deploy /accuracy body without `timeline` crashed the page.
  await page.route('**/api/v1/accuracy**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.timeline;
    await route.fulfill({ response, json: body });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/accuracy?gate=09:50');
  await expect(page.getByText(/above actual output in 84% of hours/)).toBeVisible();
  await expect(page.getByText('Forecast at the gate vs actual, every hour')).toHaveCount(0);
  expect(errors).toEqual([]);
});
