import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

const day = '/brief?date=2026-01-27&gate=09:50';

async function headline(page: Page) {
  const region = page.getByRole('region', { name: 'Forecast at gate closure' });
  await expect(region).toBeVisible();
  return region;
}

async function exportCsv(page: Page) {
  await page.getByText('Hourly data').click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /export hourly data as csv/i }).click();
  const download = await downloading;
  const text = await readFile((await download.path())!, 'utf-8');
  return { name: download.suggestedFilename(), text };
}

test.describe('Day-Ahead', () => {
  test('deep link shows the forecast available at the gate, actuals only on request', async ({
    page,
  }) => {
    await page.goto(day);
    const h = await headline(page);
    await expect(h).toContainText('Delivery Wed 28 Jan 2026');
    await expect(h).toContainText('267.2 GWh');
    await expect(h).toContainText('Run published Tue 27 Jan 09:30 UK');
    await expect(h).toContainText(/Stale feed: .* Mon 26 Jan 18:30 UK/);
    await expect(h).not.toContainText('Actual:');

    // Keyboard: focus the switch and toggle it with Space.
    await page.getByRole('switch', { name: 'Show actuals' }).focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/reveal=1/);
    await expect(h).toContainText('Actual: 138.2 GWh. The forecast was 129.0 GWh');
  });

  test('the gate selector changes which forecast run is used', async ({ page }) => {
    await page.goto(day);
    const gate = page.getByLabel('Gate closure', { exact: true });
    await gate.selectOption('09:20');
    await expect(page).toHaveURL(/gate=09%3A20|gate=09:20/);
    await expect(await headline(page)).toContainText('Run published Tue 27 Jan 07:30 UK');
    await gate.selectOption('15:30');
    await expect(await headline(page)).toContainText('Run published Tue 27 Jan 15:30 UK');
    await gate.selectOption('custom');
    await page.getByLabel('Custom gate closure time, UK').fill('12:00');
    await expect(await headline(page)).toContainText('Run published Tue 27 Jan 11:30 UK');
  });

  test('date stepping moves decision and delivery days together', async ({ page }) => {
    await page.goto(day);
    await page.getByRole('button', { name: 'Next decision day' }).click();
    await expect(page).toHaveURL(/date=2026-01-28/);
    const h = await headline(page);
    await expect(h).toContainText('Delivery Thu 29 Jan 2026');
    await expect(h).toContainText('on Wed 28 Jan 2026');
  });

  test('CSV export matches the hourly table and includes the plan', async ({ page }) => {
    await page.goto(`${day}&reveal=1`);
    const { name, text } = await exportCsv(page);
    expect(name).toBe('winddesk_decision_2026-01-27_gate-0950_with-actuals.csv');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(25);
    const cols = lines[0]!.split(',');
    const first = lines[1]!.split(',');
    expect(lines[1]).toContain('2026-01-28T00:00:00Z,2026-01-28 00:00,');
    const forecast = Number(first[cols.indexOf('forecast_mw')]);
    expect(Number(first[cols.indexOf('buy_if_forecast_mw')])).toBe(30000 - forecast);
    await expect(page.locator('table tbody tr')).toHaveCount(24);
  });

  test('a gate before the first run shows a partial day and no error history', async ({ page }) => {
    await page.goto('/brief?date=2026-01-01&gate=00:00');
    const h = await headline(page);
    await expect(h).toContainText('The forecast covers only 22 of 24 hours at this gate');
    await expect(h).toContainText('No January day had finished before this decision');
  });

  test('invalid URL parameters fall back to the latest decision', async ({ page }) => {
    await page.goto('/brief?date=2030-01-01&gate=99:99');
    await expect(await headline(page)).toContainText('as known at 09:50 UK on Sat 31 Jan 2026');
  });

  test('API failures show an actionable error that can be retried', async ({ page }) => {
    await page.route('**/api/v1/decisions/**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Unavailable', status: 503, detail: 'Snapshot offline' }),
      }),
    );
    await page.goto(day);
    await expect(page.getByRole('alert')).toContainText('Snapshot offline');
    await page.unroute('**/api/v1/decisions/**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await headline(page);
  });
});

test.describe('Landing and buy beyond wind', () => {
  test('the app opens on the latest decision with error history known at the gate', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/brief/);
    const h = await headline(page);
    await expect(h).toContainText('as known at 09:50 UK on Sat 31 Jan 2026');
    await expect(h).toContainText('29 January days completed before this decision');
  });

  test('a demand you type is kept in the URL and checked against actuals', async ({ page }) => {
    await page.goto(day);
    // Default 30,000 MW: 24 h x 30,000 MW = 720 GWh demand; forecast wind 267.2 GWh.
    await expect(page.getByText('452.8 GWh', { exact: true })).toBeVisible();
    await page.getByLabel('Demand').fill('25000');
    await expect(page).toHaveURL(/demand=25000/);
    await expect(page.getByText('332.8 GWh', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('332.8 GWh', { exact: true })).toBeVisible();
    await page.getByRole('switch', { name: 'Show actuals' }).click();
    // Buying on the forecast was short by exactly the day's energy error.
    await expect(page.getByText(/left you short by 129\.0 GWh/)).toBeVisible();
  });
});

test.describe('Accuracy', () => {
  test('the timeline plots the gate-time forecast for every hour of January', async ({ page }) => {
    await page.goto('/accuracy?gate=09:50');
    await expect(page.getByText('too high in 84% of hours')).toBeVisible();
    await expect(
      page.getByRole('img', {
        name: /forecast available at 09:50 and actual wind generation, 744 hours/,
      }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: /against minimum forecast age/ })).toBeVisible();
    await page.getByLabel('Gate closure', { exact: true }).selectOption('09:20');
    await expect(
      page.getByRole('img', {
        name: /forecast available at 09:20 and actual wind generation, 744 hours/,
      }),
    ).toBeVisible();
  });

  test('a worst day opens in Day-Ahead with actuals, and back returns', async ({ page }) => {
    await page.goto('/accuracy?gate=09:50');
    await page
      .getByRole('link', { name: /Open day/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/brief\?date=2026-01-27&gate=09:50&reveal=1/);
    await expect(await headline(page)).toContainText('Actual: 138.2 GWh');
    await page.goBack();
    await expect(page).toHaveURL(/\/accuracy/);
    await expect(page.getByText('Worst days')).toBeVisible();
  });

  test('date-range deep links survive a reload (SPA fallback)', async ({ page }) => {
    await page.goto('/accuracy?from=2026-01-05&to=2026-01-12');
    await expect(page.getByText(/over these 8 days/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/192 of 192 hours scored/)).toBeVisible(); // 8 days x 24 h
  });
});

test('the old Horizon Explorer route redirects to Accuracy', async ({ page }) => {
  await page.goto('/horizon?h=24');
  await expect(page).toHaveURL(/\/accuracy/);
  await expect(page.getByRole('heading', { name: 'Forecast accuracy' })).toBeVisible();
});

test('unknown routes render the in-app not-found page', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByText('No page at /does-not-exist')).toBeVisible();
  await expect(page).toHaveTitle('Page not found · WindDesk');
});

test.describe('responsive layout @mobile', () => {
  for (const path of ['/brief?date=2026-01-27&reveal=1', '/accuracy', '/methodology']) {
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
    delete body.by_forecast_age;
    await route.fulfill({ response, json: body });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/accuracy?gate=09:50');
  await expect(page.getByText('too high in 84% of hours')).toBeVisible();
  await expect(page.getByText('Forecast at the gate vs actual')).toHaveCount(0);
  expect(errors).toEqual([]);
});
