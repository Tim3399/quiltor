import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

export type Language = 'de' | 'en';

export const languages = {
  de: {
    workshop: 'Werkstatt', text: 'Text', figures: 'Figuren', search: 'Suche', history: 'Verlauf', backups: 'Sicherungen', ready: 'Bereit',
    openSearch: 'Suche öffnen', openHistory: 'Verlauf öffnen', openGit: 'Git öffnen', openBackups: 'Sicherungen öffnen', openCommands: 'Befehlssuche öffnen', commandSearch: 'Befehlssuche',
    lightDesign: 'Helles Design', darkDesign: 'Dunkles Design', systemDesign: 'System', designChoice: 'Darstellung', enableLight: 'Helles Design aktivieren', enableDark: 'Dunkles Design aktivieren',
    authorWorkshop: 'Autorenwerkstatt', whichWorld: 'Welche Welt öffnest du?', worldIntro: 'Jede Welt besitzt ihr eigenes Manuskript, Figurenboard und Sicherungen.',
    existingWorlds: 'Bestehende Welten', newWorld: 'Neue Welt', noWorld: 'Noch keine Welt vorhanden.', lastChanged: 'Zuletzt geändert', deleteWorld: 'Welt löschen', deleteWorldTitle: 'Welt lokal löschen', deleteWorldDescription: '„{title}“ wird mit der lokalen Datenbank, lokalen Sicherungen und dem lokalen Git-Arbeitsverzeichnis gelöscht. Ein verbundenes Remote-Repository bleibt erhalten.',
    newWorldIntro: 'Beginne mit einem leeren Manuskript und einem freien Figurenboard.', worldTitle: 'Titel der Welt oder des Buches', worldExample: 'Zum Beispiel: Der letzte Garten', gitRepository: 'Git-Repository (optional)', gitExample: 'https://git.example.com/name/meine-welt.git', repositoryRecommended: 'Dringend empfohlen: Sichere jede Welt in einem eigenen privaten Repository bei GitHub, GitLab, Gitea oder einem anderen Git-Anbieter.', createWorld: 'Welt erstellen',
    loadingWorlds: 'Welten werden geladen …', openingWorkshop: 'Werkstatt wird geöffnet …', unreachable: 'Werkstatt nicht erreichbar',
    manuscript: 'Manuskript', chapter: 'Kapitel', chapters: 'Kapitel', chapterText: 'Kapiteltext', chapterTitle: 'Kapiteltitel', untitled: 'Ohne Titel', words: 'Wörter', totalWords: 'Wörter gesamt', characters: 'Zeichen', standardPages: 'Normseiten',
    navigation: 'Navigation', details: 'Details', focus: 'Fokus', versions: 'Versionen', bookPdf: 'Buch-PDF', creatingPdf: 'Erzeuge PDF …',
    undoManuscript: 'Manuskript rückgängig', redoManuscript: 'Manuskript wiederholen', closeNavigation: 'Kapitelnavigation schließen', closeInspector: 'Inspector schließen',
    chapterNote: 'Kapitelnotiz', moveUp: 'Nach oben', moveDown: 'Nach unten', chapterMarkdown: 'Kapitel als Markdown', deleteChapter: 'Kapitel löschen', writingHelpers: 'Schreibhelfer',
    figuresPlaces: 'Figuren & Orte', ownTerms: 'Eigene Begriffe', specialCharacters: 'Sonderzeichen', addTerm: 'Begriff hinzufügen', newTerm: 'Neuer Begriff',
    previousVersion: 'Frühere Fassung', nextToCurrent: 'Direkt neben dem aktuellen Text', state: 'Stand', loadingVersion: 'Fassung wird geladen …', noVersion: 'Noch keine gespeicherte Fassung vorhanden.', closeVersions: 'Kapitelversionen schließen',
    focusHelper: 'Schreibhilfe', openFocusHelper: 'Schreibhilfe öffnen', closeFocusHelper: 'Schreibhilfe schließen', leaveFocus: 'Fokusmodus verlassen',
    figuresWorld: 'Figuren & Welt', elements: 'Elemente', connections: 'Verbindungen', figure: 'Figur', animal: 'Tier', organisation: 'Organisation', object: 'Objekt', place: 'Ort', concept: 'Konzept', connect: 'Verbinden', profiles: 'Steckbriefe', import: 'Import',
    undoDiagram: 'Diagramm rückgängig', redoDiagram: 'Diagramm wiederholen', selectElement: 'Element auswählen', selectElementHelp: 'Wähle eine Figur, einen Ort oder ein Konzept, um Details und Beziehungen zu bearbeiten.',
    selection: 'Auswahl', card: 'Karte', profile: 'Steckbrief', relationships: 'Beziehungen', kind: 'Art', name: 'Name', category: 'Rolle / Kategorie', shortDescription: 'Kurzbeschreibung', accent: 'Akzent', neutral: 'Neutral', green: 'Grün',
    customFields: 'Eigene Felder', fieldName: 'Feldname', content: 'Inhalt', addField: 'Feld hinzufügen', lineStyle: 'Linienstil', normal: 'Normal', dashed: 'Gestrichelt', directed: 'Gerichtet', deleteConnection: 'Verbindung löschen',
    searchCommands: 'Suchen & Befehle', searchPlaceholder: 'Kapitel, Text, Figuren, Orte …', commands: 'Befehle', command: 'Befehl', contents: 'Inhalte',
    gitSave: 'Git · Arbeitsstand sichern', target: 'Ziel', changed: 'Geändert', files: 'Dateien', notPushed: 'Nicht gepusht', commits: 'Commits', notConfigured: 'Nicht eingerichtet', commitMessage: 'Commit-Nachricht', commitOnly: 'Nur committen', commitPush: 'Committen & pushen',
    comparison: 'Vergleich', byWord: 'Wortweise', byLine: 'Zeilenweise', allFiles: 'Alle Dateien', textOnly: 'Nur Text', states: 'Stände', sinceCommit: 'Seit letztem Commit', workingState: 'Arbeitsstand', noChanges: 'Keine Änderungen', loading: 'Lade …',
    restore: 'Wiederherstellen', restoreBackup: 'Sicherung wiederherstellen', noBackup: 'Noch keine Sicherung vorhanden.', cancel: 'Abbrechen', closeDialog: 'Dialog schließen',
  },
  en: {
    workshop: 'Workshop', text: 'Manuscript', figures: 'Characters', search: 'Search', history: 'History', backups: 'Backups', ready: 'Ready',
    openSearch: 'Open search', openHistory: 'Open history', openGit: 'Open Git', openBackups: 'Open backups', openCommands: 'Open command palette', commandSearch: 'Command palette',
    lightDesign: 'Light', darkDesign: 'Dark', systemDesign: 'System', designChoice: 'Appearance', enableLight: 'Enable light design', enableDark: 'Enable dark design',
    authorWorkshop: 'Writer’s workshop', whichWorld: 'Which world would you like to open?', worldIntro: 'Each world has its own manuscript, character board, and backups.',
    existingWorlds: 'Existing worlds', newWorld: 'New world', noWorld: 'No worlds yet.', lastChanged: 'Last changed', deleteWorld: 'Delete world', deleteWorldTitle: 'Delete local world', deleteWorldDescription: '“{title}” and its local database, backups, and Git working directory will be deleted. A connected remote repository remains untouched.',
    newWorldIntro: 'Start with an empty manuscript and a blank character board.', worldTitle: 'World or book title', worldExample: 'For example: The Last Garden', gitRepository: 'Git repository (optional)', gitExample: 'https://git.example.com/name/my-world.git', repositoryRecommended: 'Strongly recommended: Back up each world to its own private repository on GitHub, GitLab, Gitea, or another Git provider.', createWorld: 'Create world',
    loadingWorlds: 'Loading worlds …', openingWorkshop: 'Opening workshop …', unreachable: 'Workshop unavailable',
    manuscript: 'Manuscript', chapter: 'Chapter', chapters: 'Chapters', chapterText: 'Chapter text', chapterTitle: 'Chapter title', untitled: 'Untitled', words: 'Words', totalWords: 'words total', characters: 'Characters', standardPages: 'Standard pages',
    navigation: 'Navigation', details: 'Details', focus: 'Focus', versions: 'Versions', bookPdf: 'Book PDF', creatingPdf: 'Creating PDF …',
    undoManuscript: 'Undo manuscript change', redoManuscript: 'Redo manuscript change', closeNavigation: 'Close chapter navigation', closeInspector: 'Close inspector',
    chapterNote: 'Chapter note', moveUp: 'Move up', moveDown: 'Move down', chapterMarkdown: 'Chapter as Markdown', deleteChapter: 'Delete chapter', writingHelpers: 'Writing aids',
    figuresPlaces: 'Characters & places', ownTerms: 'Custom terms', specialCharacters: 'Special characters', addTerm: 'Add term', newTerm: 'New term',
    previousVersion: 'Previous version', nextToCurrent: 'Shown beside the current text', state: 'Version', loadingVersion: 'Loading version …', noVersion: 'No saved version yet.', closeVersions: 'Close chapter versions',
    focusHelper: 'Writing aid', openFocusHelper: 'Open writing aid', closeFocusHelper: 'Close writing aid', leaveFocus: 'Leave focus mode',
    figuresWorld: 'Characters & world', elements: 'elements', connections: 'connections', figure: 'Character', animal: 'Animal', organisation: 'Organization', object: 'Object', place: 'Place', concept: 'Concept', connect: 'Connect', profiles: 'Profiles', import: 'Import',
    undoDiagram: 'Undo diagram change', redoDiagram: 'Redo diagram change', selectElement: 'Select an element', selectElementHelp: 'Select a character, place, or concept to edit its details and relationships.',
    selection: 'Selection', card: 'Card', profile: 'Profile', relationships: 'Relationships', kind: 'Type', name: 'Name', category: 'Role / category', shortDescription: 'Short description', accent: 'Accent', neutral: 'Neutral', green: 'Green',
    customFields: 'Custom fields', fieldName: 'Field name', content: 'Content', addField: 'Add field', lineStyle: 'Line style', normal: 'Normal', dashed: 'Dashed', directed: 'Directed', deleteConnection: 'Delete connection',
    searchCommands: 'Search & commands', searchPlaceholder: 'Chapters, text, characters, places …', commands: 'Commands', command: 'Command', contents: 'Content',
    gitSave: 'Git · Save working state', target: 'Target', changed: 'Changed', files: 'files', notPushed: 'Not pushed', commits: 'commits', notConfigured: 'Not configured', commitMessage: 'Commit message', commitOnly: 'Commit only', commitPush: 'Commit & push',
    comparison: 'Comparison', byWord: 'By word', byLine: 'By line', allFiles: 'All files', textOnly: 'Text only', states: 'Versions', sinceCommit: 'Since last commit', workingState: 'Working state', noChanges: 'No changes', loading: 'Loading …',
    restore: 'Restore', restoreBackup: 'Restore backup', noBackup: 'No backup available yet.', cancel: 'Cancel', closeDialog: 'Close dialog',
  },
} as const;

type MessageKey = keyof typeof languages.de;
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: (key: MessageKey) => string } | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('writer-language') === 'en' ? 'en' : 'de');
  useEffect(() => { localStorage.setItem('writer-language', language); document.documentElement.lang = language; }, [language]);
  useLayoutEffect(() => {
    const keys = Object.keys(languages.de) as MessageKey[];
    const blocked = '.chapter-title,.prose-editor,.chapter-name,.historical-prose,.story-node strong,.story-node small,[data-no-i18n]';
    const localize = (value: string) => {
      const paddingStart = value.match(/^\s*/)?.[0] || '', paddingEnd = value.match(/\s*$/)?.[0] || '';
      const content = value.trim();
      const key = keys.find(item => languages.de[item] === content || languages.en[item] === content);
      return key ? `${paddingStart}${languages[language][key]}${paddingEnd}` : value;
    };
    const visit = (root: ParentNode) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (parent?.closest(blocked) || !node.nodeValue?.trim()) continue;
        const translated = localize(node.nodeValue);
        if (translated !== node.nodeValue) node.nodeValue = translated;
      }
      root.querySelectorAll?.<HTMLElement>('[aria-label],[title],[placeholder]').forEach(element => {
        for (const attribute of ['aria-label', 'title', 'placeholder']) {
          const value = element.getAttribute(attribute); if (value) element.setAttribute(attribute, localize(value));
        }
      });
    };
    visit(document.body);
    const observer = new MutationObserver(records => records.forEach(record => {
      if (record.type === 'characterData' && record.target.parentNode) visit(record.target.parentNode);
      record.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE) visit(node as Element); else if (node.parentNode) visit(node.parentNode); });
    }));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t: (key: MessageKey) => languages[language][key] }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used within LanguageProvider');
  return value;
}
