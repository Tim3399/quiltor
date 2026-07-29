import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openBlankWorld(page: import('@playwright/test').Page, title = 'Testwelt') {
  const response = await page.request.post('/api/worlds/create', { data: { title, gitUrl: `https://gitlab.com/example/${crypto.randomUUID()}.git` } });
  const payload = await response.json();
  await page.goto(`/?world=${payload.world.id}`);
}

test('Text, Suche und Figurenboard laden ohne Laufzeitfehler', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openBlankWorld(page);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  if ((page.viewportSize()?.width || 0) <= 820) {
    await expect(page.locator('aside.binder')).toHaveCount(0);
    await page.getByRole('button', { name: /Navigation/ }).click();
    await expect(page.locator('aside.binder')).toBeVisible();
    await page.getByRole('button', { name: 'Kapitelnavigation schließen' }).click();
    await expect(page.locator('aside.binder')).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath('text.png'), fullPage: true });

  await page.getByRole('button', { name: /Suche öffnen/ }).click();
  await page.getByPlaceholder('Kapitel, Text, Figuren, Orte …').fill('Test');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Figuren' }).click();
  await expect(page.getByLabel('Figuren und Beziehungen')).toBeVisible();
  await expect(page.locator('.story-node')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('figures.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('Shortcuts unterscheiden Speichern und Git', async ({ page }) => {
  await openBlankWorld(page);
  await page.keyboard.press('Control+Shift+S');
  await expect(page.getByRole('dialog', { name: /Git/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+S');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Figuren folgen dem Zeiger bereits während des Ziehens', async ({ page }) => {
  await page.route('**/api/manuscript', route => route.fulfill({ json: { chapters: [{ id: 'c1', title: 'Test', body: '', note: '' }] }, headers: { ETag: '"0"' } }));
  await page.route('**/api/state', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { nodes: [{ id: 'n1', x: 100, y: 100, type: 'person', name: 'Testfigur' }], edges: [] }, headers: { ETag: '"0"' } })
    : route.fulfill({ json: { ok: true, revision: 1 }, headers: { ETag: '"1"' } }));
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Figuren' }).click();
  const node = page.locator('.react-flow__node').first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const before = await node.getAttribute('style');
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 45, { steps: 6 });
  await expect.poll(() => node.getAttribute('style')).not.toBe(before);
  await page.mouse.up();
});

test('Fokusmodus bietet eine diskrete Schreibhilfe', async ({ page }, testInfo) => {
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Fokus' }).click();
  const helper = page.getByRole('complementary', { name: 'Schreibhilfe im Fokusmodus' });
  await expect(helper).toBeVisible();
  await helper.getByRole('button', { name: 'Schreibhilfe öffnen' }).click();
  await expect(helper).toContainText('Figuren & Orte');
  await expect(helper).toContainText('Sonderzeichen');
  await page.screenshot({ path: testInfo.outputPath('focus-helper.png'), fullPage: true });
});

test('Kapitelversionen erscheinen direkt neben der Schreibfläche', async ({ page }, testInfo) => {
  await page.route('**/api/log', route => route.fulfill({ json: { ok: true, commits: [{ hash: 'abc123', kurz: 'abc123', datum: '01.01.2026 12:00', betreff: 'Frühere Fassung' }] } }));
  await page.route('**/api/textfassung**', route => route.fulfill({ json: { ok: true, text: 'Historischer Kapiteltext' } }));
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Versionen' }).click();
  const history = page.getByRole('complementary', { name: 'Kapitelversionen' });
  await expect(history).toBeVisible();
  await expect(history).toContainText('Historischer Kapiteltext');
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chapter-history.png'), fullPage: true });
});

test('Buchausgabe rendert als echtes 6×9-Zoll-PDF', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'PDF-Geometrie muss nur einmal geprüft werden.');
  await openBlankWorld(page);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.length).toBeGreaterThan(10_000);
  expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+432\s+648\s*\]/);
});

test('Autosave überlebt Reload und meldet konkurrierende Änderungen', async ({ page }) => {
  let revision = 0;
  let manuscript = { chapters: [{ id: 'c1', title: 'Test', body: 'Anfang', note: '' }], words: [], zeichenAktiv: [] };
  await page.route('**/api/manuscript', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: manuscript, headers: { ETag: `"${revision}"` } });
    const expected = Number((route.request().headers()['if-match'] || '').replaceAll('"', ''));
    if (expected !== revision) return route.fulfill({ status: 409, json: { code: 'conflict', fehler: 'Konflikt' } });
    manuscript = route.request().postDataJSON(); revision += 1;
    return route.fulfill({ json: { ok: true, zeit: '12:00', revision }, headers: { ETag: `"${revision}"` } });
  });
  await page.route('**/api/state', route => route.fulfill({ json: { nodes: [], edges: [] }, headers: { ETag: '"0"' } }));
  await openBlankWorld(page);
  await page.getByLabel('Kapiteltext').fill('Nach Reload vorhanden');
  await expect(page.locator('.save-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Kapiteltext')).toHaveValue('Nach Reload vorhanden');
  revision += 1;
  await page.getByLabel('Kapiteltext').fill('Konkurrierender Stand');
  await expect(page.locator('.save-error')).toBeVisible();
});

test('Kernansichten haben keine automatisiert erkennbaren WCAG-A/AA-Verstöße', async ({ page }) => {
  await openBlankWorld(page);
  const textResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(textResults.violations).toEqual([]);
  await page.getByRole('button', { name: 'Figuren' }).click();
  const figureResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(figureResults.violations).toEqual([]);
});

test('Dunkles Design bleibt erhalten und ist in den Kernansichten zugänglich', async ({ page }, testInfo) => {
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Dunkles Design aktivieren' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Helles Design aktivieren' })).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('dark-text.png'), fullPage: true });
  await page.getByRole('button', { name: 'Figuren' }).click();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('dark-figures.png'), fullPage: true });
});


test('Startseite lädt eine Welt und übernimmt ihren variablen Titel', async ({ page }) => {
  await page.request.post('/api/worlds/create', { data: { title: 'Öffentliche Testwelt' } });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welche Welt öffnest du?' })).toBeVisible();
  await page.getByRole('button', { name: /Öffentliche Testwelt/ }).click();
  await expect(page.locator('.brand')).toContainText('Öffentliche Testwelt');
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
});

test('Sprachwahl erfolgt ausschließlich in der Welt-Auswahl', async ({ page }) => {
  await page.request.post('/api/worlds/create', { data: { title: 'Language Test World', gitUrl: 'git@git.example.com:example/language-test.git' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Which world would you like to open?' })).toBeVisible();
  await page.getByRole('button', { name: /Language Test World/ }).click();
  await expect(page.locator('.workspace-switch').getByRole('button', { name: 'Manuscript', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Language / Sprache' })).toHaveCount(0);
});
