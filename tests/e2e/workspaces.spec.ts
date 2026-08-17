import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openBlankWorld(page: import('@playwright/test').Page, title = 'Testwelt', backupUrl = '') {
  const response = await page.request.post('/api/worlds/create', { data: { title, backupUrl } });
  const payload = await response.json();
  await page.goto(`/?world=${payload.world.id}`);
}

test('Weltenauswahl bleibt auch mit vielen Welten vollständig scrollbar', async ({ page }) => {
  const worlds = Array.from({ length: 30 }, (_, index) => ({ id: `world-${index + 1}`, title: `Welt ${index + 1}`, updated: '2026-08-09T12:00:00Z' }));
  await page.route('**/api/worlds', route => route.fulfill({ json: { worlds } }));
  await page.goto('/');
  const gate = page.locator('.world-gate');
  const lastWorld = page.locator('.world-open').filter({ hasText: 'Welt 30' });
  await expect(lastWorld).toBeAttached();
  await expect.poll(() => gate.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await lastWorld.scrollIntoViewIfNeeded();
  await expect(lastWorld).toBeVisible();
  expect(await gate.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('Text, Suche und Figurenboard laden ohne Laufzeitfehler', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openBlankWorld(page);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  if ((page.viewportSize()?.width || 0) <= 820) {
    await expect(page.locator('aside.binder')).toHaveCount(0);
    await page.getByRole('button', { name: /Navigation/ }).click();
    const navigation = (page.viewportSize()?.width || 0) < 720 ? page.getByRole('dialog', { name: 'Kapitel' }) : page.locator('aside.binder');
    await expect(navigation).toBeVisible();
    await page.getByRole('button', { name: 'Kapitelnavigation schließen' }).click();
    await expect(navigation).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath('text.png'), fullPage: true });

  await page.keyboard.press('Control+KeyF');
  await page.getByRole('combobox', { name: 'Suchbegriff' }).fill('Test');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Figuren' }).click();
  await expect(page.getByLabel('Figuren und Beziehungen')).toBeVisible();
  await expect(page.locator('.story-node')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('figures.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('CodeMirror hält Textauswahl für kontextuelle Schreibwerkzeuge stabil', async ({ page }) => {
  await openBlankWorld(page);
  const editor = page.getByLabel('Kapiteltext');
  await editor.fill('Der Morgen lag still über dem Hafen.');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-placeholder')).toBeVisible();
  await editor.fill('Der Morgen lag still über dem Hafen.');
  await page.locator('.cm-line').selectText();
  // Markieren allein öffnet nichts mehr -- die Nachschlage-Aktionen sind eine eigene
  // Anfrage, so wie unter macOS. Sichtbar ist die Markierung trotzdem.
  const selectionMenu = page.getByRole('dialog', { name: 'Aktionen für die Textauswahl' });
  await expect(selectionMenu).toBeHidden();
  await expect(page.locator('.held-selection')).toContainText('Der Morgen lag still über dem Hafen.');
  await page.locator('.cm-line').click({ button: 'right' });
  await expect(selectionMenu).toBeVisible();
  await selectionMenu.getByRole('menuitem', { name: 'Nachschlagen' }).click();
  // Die Schreibhilfe hat keine eigene Markierungskarte mehr (.writing-selection-state ist fort).
  // Die Markierung *ist* die Frage, also steht sie im Suchfeld der Schreibhilfe.
  await expect(page.getByRole('textbox', { name: 'Suchbegriff' })).toHaveValue('Der Morgen lag still über dem Hafen.');
  await expect(editor).toHaveText('Der Morgen lag still über dem Hafen.');
  await expect(page.getByText(/Sprachdaten sind nicht installiert|Keine Ergebnisse gefunden/)).toBeVisible();
});

test('Fett und Kursiv liegen als Bereiche am Kapitel und überleben das Neuladen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'Die Auszeichnung hängt nicht an der Fensterbreite.');
  await openBlankWorld(page);
  const editor = page.getByLabel('Kapiteltext');
  await editor.fill('Der Morgen lag still über dem Hafen.');
  const selectionMenu = page.getByRole('dialog', { name: 'Aktionen für die Textauswahl' });

  await page.locator('.cm-line').selectText();
  await page.locator('.cm-line').click({ button: 'right' });
  await selectionMenu.getByRole('menuitem', { name: 'Fett' }).click();
  await expect(page.locator('.prose-editor .text-bold')).toContainText('Der Morgen lag still über dem Hafen.');

  await page.locator('.cm-line').selectText();
  await page.locator('.cm-line').click({ button: 'right' });
  await selectionMenu.getByRole('menuitem', { name: 'Kursiv' }).click();
  await expect(page.locator('.prose-editor .text-italic')).toContainText('Der Morgen lag still über dem Hafen.');

  // Die Auszeichnung ist kein Zeichen im Text, sondern ein Bereich neben ihm (Chapter.marks).
  // Der Beweis dafür ist, dass der Text unverändert bleibt und die Bereiche das Speichern überstehen.
  await expect(editor).toHaveText('Der Morgen lag still über dem Hafen.');
  await expect(page.locator('.save-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Kapiteltext')).toHaveText('Der Morgen lag still über dem Hafen.');
  await expect(page.locator('.prose-editor .text-bold')).toContainText('Der Morgen lag still über dem Hafen.');
  await expect(page.locator('.prose-editor .text-italic')).toContainText('Der Morgen lag still über dem Hafen.');
});

test('Kapitel- und Schreibhilfe-Spalte lassen sich aus der Werkzeugleiste umschalten', async ({ page }) => {
  await openBlankWorld(page);
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  const toggles = page.locator('.panel-toggles');
  const chapters = toggles.getByRole('button', { name: 'Kapitel', exact: true });
  const aid = toggles.getByRole('button', { name: 'Schreibhilfe', exact: true });
  await expect(chapters).toBeVisible();
  await expect(aid).toBeVisible();
  const width = page.viewportSize()?.width || 0;

  if (width >= 1100) {
    // Breit ist Platz für beides: die Spalten stehen nebeneinander und schließen sich nicht aus.
    await expect(chapters).toHaveAttribute('aria-pressed', 'true');
    await expect(aid).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('aside.binder')).toHaveCount(1);
    await expect(page.locator('aside.inspector')).toHaveCount(1);
    await chapters.click();
    await expect(page.locator('aside.binder')).toHaveCount(0);
    await expect(page.locator('aside.inspector')).toHaveCount(1);
    await chapters.click();
    await expect(page.locator('aside.binder')).toHaveCount(1);
  } else if (width < 720) {
    // Unter 720px sind beide Spalten Sheets. Ein Sheet ist modal, also muss das eine zu sein,
    // bevor das andere aufgeht -- deshalb hier über den Schließen-Knopf statt über die Leiste.
    await expect(page.locator('aside.binder')).toHaveCount(0);
    await chapters.click();
    const binderSheet = page.getByRole('dialog', { name: 'Kapitel' });
    await expect(binderSheet).toBeVisible();
    await expect(binderSheet.getByLabel('Kapitelnotiz')).toBeVisible();
    await page.getByRole('button', { name: 'Kapitelnavigation schließen' }).click();
    await expect(binderSheet).toHaveCount(0);
    await aid.click();
    const aidSheet = page.getByRole('dialog', { name: 'Schreibhilfe' });
    await expect(aidSheet).toBeVisible();
    await expect(aidSheet.getByRole('tab', { name: 'Nachschlagen' })).toBeVisible();
  } else {
    // 720-1100: beide Spalten liegen als Schublade über dem Text, also kann nur eine offen sein.
    await expect(chapters).toHaveAttribute('aria-pressed', 'true');
    await expect(aid).toHaveAttribute('aria-pressed', 'false');
    await aid.click();
    await expect(aid).toHaveAttribute('aria-pressed', 'true');
    await expect(chapters).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('aside.binder')).toHaveCount(0);
    await expect(page.locator('aside.inspector')).toHaveCount(1);
    await chapters.click();
    await expect(chapters).toHaveAttribute('aria-pressed', 'true');
    await expect(aid).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('aside.inspector')).toHaveCount(0);
  }
});

test('Kapiteleigenschaften hängen am Kapitel, nicht mehr in einem Inspektor-Tab', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'Der Weg zu den Kapiteleigenschaften ist in einer Breite geprüft; die Spaltenlogik hat einen eigenen Test.');
  await openBlankWorld(page);
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();

  // Der Titel steht über dem Text, nicht mehr rechts in einer Eigenschaftenspalte.
  const title = page.getByRole('textbox', { name: 'Kapiteltitel' });
  await expect(title).toBeVisible();
  await expect(page.locator('.editor-document .chapter-title')).toHaveCount(1);

  // Die Zählungen sind Status und stehen in der Statuszeile.
  const stats = page.locator('.context-bar .chapter-stats');
  await expect(stats).toContainText('Wörter');
  await expect(stats).toContainText('Zeichen');
  await expect(stats).toContainText('Normseiten');

  // Die Notiz liegt links unter der Kapitelliste.
  await expect(page.locator('aside.binder').getByLabel('Kapitelnotiz')).toBeVisible();

  // Der zweigeteilte Inspektor ist fort: rechts gibt es nur noch die Schreibhilfe.
  await expect(page.getByRole('tab', { name: 'Kapitel', exact: true })).toHaveCount(0);
  await expect(page.locator('aside.inspector')).toContainText('Schreibhilfe');

  // Verschieben, Export und Löschen hängen am ⋯ neben dem Titel.
  await page.getByRole('button', { name: 'Kapitelaktionen' }).click();
  const menu = page.getByRole('menu', { name: 'Kapitelaktionen' });
  for (const item of ['Nach oben', 'Nach unten', 'Kapitel als Markdown', 'Kapitel löschen']) {
    await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
});

test('Shortcuts unterscheiden Speichern und Sicherung', async ({ page }) => {
  // Seit die Sicherung auf Schnappschuss + Endpunkt umgestellt ist, hängt "Hochladen" an zwei
  // Bedingungen: eingerichteter Endpunkt und beschriebener Stand. Die Welt bringt deshalb eine
  // Backup-URL mit -- ohne sie prüfte der Test nur noch, dass der Knopf grundsätzlich tot ist.
  await openBlankWorld(page, 'Testwelt', 'https://backup.example.com/shortcut-test');
  await page.keyboard.press('Control+Shift+S');
  const dialog = page.getByRole('dialog', { name: /Arbeitsstand sichern/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Was hat sich geändert?').fill('Zwischenstand aus dem Test');
  await expect(dialog.getByRole('button', { name: 'Sichern & hochladen' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+S');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Lokaler Assistent übernimmt Weltpflege nur bestätigt und als einen Undo-Schritt', async ({ page }) => {
  await page.route('**/api/assistant/status*', route => route.fulfill({ json: { ok: true, available: true, mode: 'local', reason: '', chunks: 7 } }));
  await page.route('**/api/assistant/chat', route => route.fulfill({ json: {
    ok: true,
    message: 'Ich habe Ada, Bela und ihre Beziehung als Vorschläge vorbereitet.',
    sources: [{ id: 'chapter:c1:0', kind: 'chapter', title: 'Erstes Kapitel', text: 'Ada begegnet Bela.', target: { workspace: 'text', id: 'c1' } }],
    proposals: [
      { kind: 'create_element', tempId: 'new:ada', element: { type: 'person', name: 'Ada', label: 'Archivarin' } },
      { kind: 'create_element', tempId: 'new:bela', element: { type: 'person', name: 'Bela', label: 'Regent' } },
      { kind: 'create_relationship', relationship: { from: 'new:ada', to: 'new:bela', label: 'Misstrauen', directed: false } },
    ],
  } }));
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Lokalen Assistenten öffnen' }).click();
  const drawer = (page.viewportSize()?.width || 0) < 720 ? page.getByRole('dialog', { name: 'Lokaler Assistent' }) : page.getByRole('complementary', { name: 'Lokaler Assistent' });
  await expect(drawer).toContainText('7 Quellen indexiert');
  const assistantPanel = (page.viewportSize()?.width || 0) < 720 ? drawer.locator('.assistant-drawer') : drawer;
  // Unter 720px fährt der Assistent als Bottom-Sheet ein. Eine einmalige Messung trifft sonst die
  // laufende Animation, deshalb wird bis zum Stillstand gepollt statt einmal abgefragt.
  await expect.poll(async () => {
    const drawerBox = await assistantPanel.boundingBox(), composerBox = await assistantPanel.locator('footer').boundingBox();
    return drawerBox && composerBox ? Math.abs(composerBox.y + composerBox.height - (drawerBox.y + drawerBox.height)) < 1 : false;
  }).toBe(true);
  await drawer.getByRole('textbox', { name: 'Nachricht an den lokalen Assistenten' }).fill('Lege Ada und Bela mit ihrer Beziehung an.');
  await drawer.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(drawer).toContainText('Erstes Kapitel');
  await drawer.getByRole('button', { name: 'Alle übernehmen' }).click();
  await expect(page.locator('.story-node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.story-node')).toHaveCount(0);
});

test('Befehlspalette führt alle sichtbaren Aktionen atomar aus', async ({ page }) => {
  await openBlankWorld(page);
  const open = async () => { await page.keyboard.press('Control+KeyK'); await expect(page.getByRole('heading', { name: 'Suchen & Befehle' })).toBeVisible(); };
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  await open(); await page.getByRole('dialog').getByRole('option', { name: /Zum Manuskript wechseln/ }).click();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-current', 'page');
  await open(); await page.getByRole('dialog').getByRole('option', { name: /Zum Figurenboard wechseln/ }).click();
  await expect(page.getByRole('button', { name: 'Figuren', exact: true })).toHaveAttribute('aria-current', 'page');
  await open(); await page.getByRole('dialog').getByRole('option', { name: /Fokusmodus umschalten/ }).click();
  await expect(page.getByRole('button', { name: /Fokusmodus verlassen/ })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const command of ['Verlauf öffnen', 'Sicherung öffnen', 'Sicherungen öffnen']) {
    await open(); await page.getByRole('dialog').getByRole('option', { name: new RegExp(command) }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: /schließen/i }).click();
  }
});

test('Inhaltssuche und Befehle teilen eine Palette', async ({ page }) => {
  await openBlankWorld(page);
  await page.keyboard.press('Control+KeyF');
  await expect(page.getByRole('heading', { name: 'Suchen & Befehle' })).toBeVisible();
  await expect(page.getByText('Zum Manuskript wechseln')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+KeyK');
  await expect(page.getByRole('heading', { name: 'Suchen & Befehle' })).toBeVisible();
  await expect(page.getByText('Zum Manuskript wechseln')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  if ((page.viewportSize()?.width || 0) > 640) {
    await page.getByRole('button', { name: 'Element', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByText(/Elemente ·/).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Noch keine Timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Zeitpunkt hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Neuer Zeitpunkt' })).toBeVisible();
  if ((page.viewportSize()?.width || 0) > 640) await expect(page.getByRole('navigation', { name: 'Timeline' })).toBeVisible();
  else await expect(page.getByText('1 von 1')).toBeVisible();
  await expect(page.getByText('Nur Änderungen')).toBeVisible();
});

test('Figuren folgen dem Zeiger bereits während des Ziehens', async ({ page }) => {
  await page.route('**/api/manuscript*', route => route.fulfill({ json: { chapters: [{ id: 'c1', title: 'Test', body: '', note: '' }] }, headers: { ETag: '"0"' } }));
  await page.route('**/api/state*', route => route.request().method() === 'GET'
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

test('Minimap unterscheidet Elementarten und das Raster lässt sich lösen', async ({ page }) => {
  await page.route('**/api/manuscript*', route => route.fulfill({ json: { chapters: [{ id: 'c1', title: 'Test', body: '', note: '' }] }, headers: { ETag: '"0"' } }));
  await page.route('**/api/state*', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { nodes: [
      { id: 'n1', x: 101, y: 101, type: 'person', name: 'Figur' },
      { id: 'n2', x: 401, y: 101, type: 'ort', name: 'Ort' },
      { id: 'n3', x: 701, y: 101, type: 'konzept', name: 'Konzept' },
    ], edges: [] }, headers: { ETag: '"0"' } })
    : route.fulfill({ json: { ok: true, revision: 1 }, headers: { ETag: '"1"' } }));
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();

  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(3);
  const fills = await page.locator('.react-flow__minimap-node').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
  expect(new Set(fills).size).toBe(3);
  const sizes = await page.locator('.story-node').evaluateAll(nodes => nodes.map(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height })));
  const expectedHeight = (page.viewportSize()?.width || 0) < 720 ? '68px' : '96px';
  expect(sizes).toEqual(Array.from({ length: 3 }, () => ({ width: '200px', height: expectedHeight })));
  await expect(page.locator('.react-flow__background path')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ansicht', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Anordnen', exact: true }).click();
  await expect.poll(() => page.locator('.react-flow__node').first().getAttribute('style')).toContain('translate(96px, 96px)');
  await page.getByRole('button', { name: 'Ansicht', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Raster ausblenden', exact: true }).click();
  await expect(page.locator('.react-flow__background')).toHaveCount(0);
});

test('Verschieben erhält alle Elemente auch nach Autosave und Neuladen', async ({ page }) => {
  const response = await page.request.post('/api/worlds/create', { data: { title: `Drag Regression ${crypto.randomUUID()}` } });
  const created = await response.json();
  const initial = await page.request.get('/api/state');
  const revision = initial.headers()['etag'] || '"0"';
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, x: 100 + (index % 4) * 240, y: 100 + Math.floor(index / 4) * 150, type: 'person', name: `Figur ${index}` }));
  const edges = Array.from({ length: 11 }, (_, index) => ({ id: `e${index}`, from: `n${index}`, to: `n${index + 1}`, label: `Beziehung ${index}`, gerichtet: index % 2 === 0 }));
  await page.request.put('/api/state', { headers: { 'If-Match': revision }, data: { nodes, edges } });
  await page.goto(`/?world=${created.world.id}`);
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  await expect(page.locator('.story-node')).toHaveCount(12);
  const node = page.locator('.react-flow__node').first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.story-node')).toHaveCount(12);
  await expect(page.locator('.react-flow__edge')).toHaveCount(11);
  await page.waitForTimeout(1100);
  await page.reload();
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  await expect(page.locator('.story-node')).toHaveCount(12);
});

test('Elementtypen sind konsistent erreichbar und Löschen bestätigt ohne Halten', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'Der Löschweg muss nur in einer Breite geprüft werden.');
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Element', exact: true })).toBeVisible();
  for (const label of ['Figur', 'Ort', 'Konzept', 'Tier', 'Organisation', 'Objekt']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Element', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(6);
  for (const label of ['Tier', 'Organisation', 'Objekt']) await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Figur', exact: true }).click();
  await expect(page.locator('.story-node')).toHaveCount(1);
  // useHistoryState fasst Änderungen innerhalb von 650 ms zu einem Schritt zusammen. Ohne diese
  // Pause landeten Anlegen und Löschen im selben Schritt und das Undo sprang hinter beide zurück.
  await page.waitForTimeout(900);
  await page.locator('.story-node').click();
  await page.getByRole('button', { name: 'Figur löschen' }).click();
  // Das Element hängt am Undo-Stack, also genügt hier eine Rückfrage: sie nennt den Rückweg und
  // bestätigt mit einem Klick. Das Halten bleibt den Aktionen vorbehalten, die niemand zurückholt.
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/rückgängig machen/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Element löschen' }).click();
  await expect(page.locator('.story-node')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.story-node')).toHaveCount(1);
});

test('Zeitstreifen spielt Beziehungsstände und Todeszeitpunkte ab', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'Die Timeline wird im breiten Figurenboard geprüft.');
  await page.route('**/api/manuscript*', route => route.fulfill({ json: { chapters: [{ id: 'c1', title: 'Test', body: '', note: '' }] }, headers: { ETag: '"0"' } }));
  await page.route('**/api/state*', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { nodes: [{ id: 'n1', x: 120, y: 140, type: 'person', name: 'Ada' }, { id: 'n2', x: 520, y: 140, type: 'person', name: 'Bela' }], edges: [{ id: 'e1', from: 'n1', to: 'n2', label: 'Verbündete' }, { id: 'e2', from: 'n2', to: 'n1', label: 'Bewundert', gerichtet: true }] }, headers: { ETag: '"0"' } })
    : route.fulfill({ json: { ok: true, revision: 1 }, headers: { ETag: '"1"' } }));
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Figuren', exact: true }).click();
  await expect(page.locator('.neutral-handle')).toHaveCount(4);
  await expect(page.locator('.incoming-handle')).toHaveCount(2);
  await expect(page.locator('.outgoing-handle')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge.edge-undirected')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge.edge-directed')).toHaveCount(1);
  const stableGeometry = async () => Promise.all((await page.locator('.story-node').all()).map(async node => {
    const box = await node.boundingBox();
    return box && { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const geometryBeforeTimeline = await stableGeometry();
  await page.locator('.story-node').filter({ hasText: 'Bela' }).click();
  await page.getByRole('tab', { name: 'Beziehungen' }).click();
  await expect(page.getByLabel('Ungerichtete Beziehung')).toBeVisible();
  await page.getByRole('button', { name: 'Richtung umkehren: Bela nach Ada' }).click();
  await expect(page.getByRole('button', { name: 'Richtung umkehren: Ada nach Bela' })).toBeVisible();
  const controlsBeforeTimeline = await page.locator('.react-flow__controls').boundingBox();
  const minimapBeforeTimeline = await page.locator('.react-flow__minimap').boundingBox();
  await page.getByRole('button', { name: 'Ansicht', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Zeit einblenden', exact: true }).click();
  const stripBox = await page.getByLabel('Beziehungen über die Zeit').boundingBox();
  const controlsBox = await page.locator('.react-flow__controls').boundingBox();
  const minimapBox = await page.locator('.react-flow__minimap').boundingBox();
  const overlap = (a: NonNullable<typeof stripBox>, b: NonNullable<typeof stripBox>) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(controlsBox).toEqual(controlsBeforeTimeline);
  expect(minimapBox).toEqual(minimapBeforeTimeline);
  expect(stripBox && controlsBox && overlap(stripBox, controlsBox)).toBeFalsy();
  expect(stripBox && minimapBox && overlap(stripBox, minimapBox)).toBeFalsy();

  await page.getByLabel('Neuer Zeitpunkt').fill('Vor der Schlacht');
  await page.getByLabel('Datum des neuen Zeitpunkts').fill('1420-03-12');
  await page.getByRole('button', { name: 'Zeitpunkt hinzufügen' }).click();
  expect(await stableGeometry()).toEqual(geometryBeforeTimeline);
  await page.locator('.story-node').filter({ hasText: 'Ada' }).click();
  await page.getByRole('tab', { name: 'Karte' }).click();
  await page.getByRole('button', { name: 'Stirbt hier' }).click();
  await expect(page.locator('.story-node').filter({ hasText: 'Ada' })).toHaveClass(/is-deceased/);

  await page.getByLabel('Neuer Zeitpunkt').fill('Nach der Schlacht');
  await page.getByRole('button', { name: 'Zeitpunkt hinzufügen' }).click();
  expect(await stableGeometry()).toEqual(geometryBeforeTimeline);
  await page.getByRole('button', { name: 'Zeitreise abspielen' }).click();
  await expect(page.getByRole('button', { name: 'Zeitreise pausieren' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vor der Schlacht' })).toHaveAttribute('aria-pressed', 'true');
  expect(await stableGeometry()).toEqual(geometryBeforeTimeline);
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

test('Fokus-Randpanels verändern Schreibfläche und Zeilenumbruch nicht', async ({ page }) => {
  await page.route('**/api/manuscript*', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { chapters: [
      { id: 'c1', title: 'Prolog', body: 'Ein langer Absatz hält seinen Zeilenumbruch beim Öffnen der Randpanels stabil.', note: '' },
      { id: 'c2', title: 'Aufbruch', body: 'Der Weg beginnt.', note: '' },
    ] }, headers: { ETag: '"0"' } })
    : route.continue());
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Fokus' }).click();

  const editor = page.locator('.editor-page');
  const initial = await editor.boundingBox();
  expect(initial).not.toBeNull();

  await page.getByRole('button', { name: 'Kapitelauswahl öffnen' }).click();
  const withChapters = await editor.boundingBox();
  expect(withChapters).toEqual(initial);
  const chapters = await page.locator('.focus-chapter-list').boundingBox();
  if ((page.viewportSize()?.width || 0) >= 1100) expect(chapters!.x + chapters!.width).toBeLessThanOrEqual(initial!.x);
  else expect(chapters!.x).toBeGreaterThanOrEqual(0);

  await page.getByRole('button', { name: 'Schreibhilfe öffnen' }).click();
  const withBoth = await editor.boundingBox();
  expect(withBoth).toEqual(initial);
  const helper = await page.locator('.focus-helper-panel').boundingBox();
  if ((page.viewportSize()?.width || 0) >= 1100) expect(helper!.x).toBeGreaterThanOrEqual(initial!.x + initial!.width);
  else expect(helper!.x + helper!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.getByRole('button', { name: 'Kapitelauswahl schließen' }).click();
  await page.getByRole('button', { name: 'Schreibhilfe schließen' }).click();
  expect(await editor.boundingBox()).toEqual(initial);
});

test('Kapitelversionen erscheinen direkt neben der Schreibfläche', async ({ page }, testInfo) => {
  await page.route('**/api/log*', route => route.fulfill({ json: { ok: true, commits: [{ hash: 'abc123', kurz: 'abc123', datum: '01.01.2026 12:00', betreff: 'Frühere Fassung' }] } }));
  await page.route('**/api/textfassung**', route => route.fulfill({ json: { ok: true, text: 'Historischer Kapiteltext' } }));
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Exportieren' }).click();
  await page.getByRole('menuitem', { name: 'Fassungen' }).click();
  const history = page.getByRole('complementary', { name: 'Fassungen' });
  await expect(history).toBeVisible();
  await expect(history).toContainText('Historischer Kapiteltext');
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chapter-history.png'), fullPage: true });
});

test('Buchausgabe rendert als echtes 6×9-Zoll-PDF', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'PDF-Geometrie muss nur einmal geprüft werden.');
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
  await page.route('**/api/manuscript*', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: manuscript, headers: { ETag: `"${revision}"` } });
    const expected = Number((route.request().headers()['if-match'] || '').replaceAll('"', ''));
    if (expected !== revision) return route.fulfill({ status: 409, json: { code: 'conflict', fehler: 'Konflikt' } });
    manuscript = route.request().postDataJSON(); revision += 1;
    return route.fulfill({ json: { ok: true, zeit: '12:00', revision }, headers: { ETag: `"${revision}"` } });
  });
  await page.route('**/api/state*', route => route.fulfill({ json: { nodes: [], edges: [] }, headers: { ETag: '"0"' } }));
  await openBlankWorld(page);
  await page.getByLabel('Kapiteltext').fill('Nach Reload vorhanden');
  await expect(page.locator('.save-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Kapiteltext')).toHaveText('Nach Reload vorhanden');
  revision += 1;
  await page.getByLabel('Kapiteltext').fill('Konkurrierender Stand');
  await expect(page.locator('.save-error')).toBeVisible();
});

test('Kernansichten haben keine automatisiert erkennbaren WCAG-A/AA-Verstöße', async ({ page }) => {
  await openBlankWorld(page);
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
  const textResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(textResults.violations).toEqual([]);
  await page.getByRole('button', { name: 'Figuren' }).click();
  const figureResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(figureResults.violations).toEqual([]);
  await page.getByRole('button', { name: 'Timeline' }).click();
  const timelineResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(timelineResults.violations).toEqual([]);
});

test('Dunkles Design bleibt erhalten und ist in den Kernansichten zugänglich', async ({ page }, testInfo) => {
  await openBlankWorld(page);
  await page.getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('menuitem', { name: 'Dunkel' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Mehr' }).click();
  await expect(page.getByRole('menuitem', { name: 'Hell' })).toBeVisible();
  await page.keyboard.press('Escape');
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
  await expect(page.getByRole('heading', { name: 'Welt öffnen' })).toBeVisible();
  await page.locator('.world-open').filter({ hasText: 'Öffentliche Testwelt' }).last().click();
  await expect(page.locator('.brand')).toContainText('Öffentliche Testwelt');
  await expect(page.getByLabel('Kapiteltext')).toBeVisible();
});

test('Welt lässt sich nur durch anhaltendes Halten lokal löschen', async ({ page }) => {
  const title = `Löschtest ${crypto.randomUUID()}`;
  await page.request.post('/api/worlds/create', { data: { title, backupUrl: 'https://backup.example.com/remote-remains' } });
  await page.request.post('/api/worlds/create', { data: { title: `Aktive Testwelt ${crypto.randomUUID()}` } });
  await page.goto('/');
  await page.getByRole('button', { name: `${title} – Welt löschen` }).click();
  await expect(page.getByRole('heading', { name: 'Welt lokal löschen' })).toBeVisible();
  await expect(page.getByText('Bereits hochgeladene Backups bleiben auf dem Endpunkt erhalten.')).toBeVisible();

  // Das Halten schützt hier, weil kein Undo greift: Datenbank, Sicherungen und Verlauf sind danach
  // fort. Der eigentliche Nachweis ist deshalb, dass ein zu frühes Loslassen nichts löscht.
  const confirm = page.getByRole('button', { name: 'Welt löschen – gedrückt halten zum Bestätigen' });
  await confirm.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' });
  await page.waitForTimeout(400);
  await confirm.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse' });
  await expect(page.getByRole('heading', { name: 'Welt lokal löschen' })).toBeVisible();

  await confirm.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' });
  await page.waitForTimeout(1700);

  await expect(page.getByRole('heading', { name: 'Welt lokal löschen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0);
});

test('Sprachwahl erfolgt ausschließlich in der Welt-Auswahl', async ({ page }) => {
  await page.request.post('/api/worlds/create', { data: { title: 'Language Test World', backupUrl: 'https://backup.example.com/language-test' } });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Englisch' }).click();
  await expect(page.getByRole('heading', { name: 'Open a world' })).toBeVisible();
  await page.locator('.world-open').filter({ hasText: 'Language Test World' }).last().click();
  await expect(page.locator('.workspace-switch').getByRole('button', { name: 'Manuscript', exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Language' })).toHaveCount(0);
});
