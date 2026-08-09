import { expect, test, type Page } from '@playwright/test';

const manuscript = { chapters: [{ id: 'c1', title: 'Die Ankunft', body: 'Der Morgen lag still über dem Hafen. Mara öffnete die Karte.', note: 'Die Unruhe nur andeuten.' }], words: [], zeichenAktiv: ['„', '“', '…'] };
const figures = {
  nodes: [
    { id: 'mara', x: 120, y: 120, type: 'person', name: 'Mara Venn', label: 'Kartographin', sub: 'Liest lebende Karten.' },
    { id: 'archiv', x: 480, y: 260, type: 'ort', name: 'Gezeitenarchiv', label: 'Ort', sub: 'Ein gläserner Bau am Hafen.', mapX: 35, mapY: 45 },
  ],
  edges: [{ id: 'e1', from: 'mara', to: 'archiv', label: 'sucht', gerichtet: true }],
  timeline: [{ id: 't1', title: 'Ankunft', date: '1847-09-03', note: 'Mara erreicht den Hafen.' }],
  presence: [],
};

async function mockWorkshop(page: Page) {
  await page.route('**/api/version', route => route.fulfill({ json: { ok: true, version: 'baseline' } }));
  await page.route('**/api/whoami', route => route.fulfill({ json: { ok: false } }));
  await page.route('**/api/worlds', route => route.fulfill({ json: { ok: true, worlds: [{ id: 'baseline', title: 'Der gläserne Atlas', gitUrl: '', updated: '2026-08-09T12:00:00Z' }] } }));
  await page.route('**/api/worlds/open', route => route.fulfill({ json: { ok: true, world: { id: 'baseline', title: 'Der gläserne Atlas', gitUrl: '', updated: '2026-08-09T12:00:00Z' } } }));
  await page.route('**/api/manuscript*', route => route.request().method() === 'GET' ? route.fulfill({ json: manuscript, headers: { ETag: '"0"' } }) : route.fulfill({ json: { ok: true, revision: 1, zeit: '12:00' } }));
  await page.route('**/api/state*', route => route.request().method() === 'GET' ? route.fulfill({ json: figures, headers: { ETag: '"0"' } }) : route.fulfill({ json: { ok: true, revision: 1, zeit: '12:00' } }));
  await page.route('**/api/assistant/status*', route => route.fulfill({ json: { ok: true, available: false, mode: 'local', reason: 'Baseline', chunks: 3 } }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Kernansichten bleiben visuell reproduzierbar`, async ({ page }) => {
    await page.addInitScript(selected => { localStorage.setItem('quiltor-theme', selected); localStorage.setItem('quiltor-interface-language', 'de'); }, theme);
    await mockWorkshop(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welche Welt öffnest du?' })).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-world-gate.png`, { animations: 'disabled' });

    await page.locator('.world-open').click();
    await expect(page.getByLabel('Kapiteltext')).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-manuscript.png`, { animations: 'disabled' });

    await page.getByRole('button', { name: 'Figuren', exact: true }).click();
    await expect(page.getByLabel('Figuren und Beziehungen')).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-figures.png`, { animations: 'disabled' });

    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-timeline.png`, { animations: 'disabled' });

    await page.getByRole('button', { name: 'Orte', exact: true }).click();
    await expect(page.locator('.places-workspace')).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-places.png`, { animations: 'disabled' });

    await page.keyboard.press('Control+KeyF');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-dialog.png`, { animations: 'disabled' });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Lokalen Assistenten öffnen' }).click();
    const assistant = (page.viewportSize()?.width || 0) < 720 ? page.getByRole('dialog', { name: 'Lokaler Assistent' }) : page.getByRole('complementary', { name: 'Lokaler Assistent' });
    await expect(assistant).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-assistant.png`, { animations: 'disabled' });
  });
}

test('Performance-Baseline für Start, Workspace-Wechsel und großes Kapitel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'Die Performance-Baseline wird im festen Wide-Viewport gemessen.');
  const large = { ...manuscript, chapters: [{ ...manuscript.chapters[0], body: 'Ein Satz im großen Kapitel. '.repeat(10_000) }] };
  await mockWorkshop(page);
  await page.unroute('**/api/manuscript*');
  await page.route('**/api/manuscript*', route => route.request().method() === 'GET' ? route.fulfill({ json: large, headers: { ETag: '"0"' } }) : route.fulfill({ json: { ok: true, revision: 1, zeit: '12:00' } }));
  const started = performance.now();
  await page.goto('/?world=baseline');
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  const appStartMs = performance.now() - started;
  const switched = performance.now();
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  await expect(page.getByLabel('Figuren und Beziehungen')).toBeVisible();
  const workspaceSwitchMs = performance.now() - switched;
  const metrics = { appStartMs: Math.round(appStartMs), workspaceSwitchMs: Math.round(workspaceSwitchMs), chapterCharacters: large.chapters[0].body.length };
  await testInfo.attach('performance-baseline.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(metrics.appStartMs).toBeLessThan(5_000);
  expect(metrics.workspaceSwitchMs).toBeLessThan(2_000);
});
