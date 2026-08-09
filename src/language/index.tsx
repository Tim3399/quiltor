import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { PRODUCT_NAME } from '../config/branding';
import { de } from './de';
import { en } from './en';

export type Language = 'de' | 'en';

export const languages = { de, en } as const;

export type MessageKey = keyof typeof de;
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: (key: MessageKey) => string } | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('writer-language') === 'en' ? 'en' : 'de');
  useEffect(() => { localStorage.setItem('writer-language', language); document.documentElement.lang = language; document.title = `${PRODUCT_NAME} · ${languages[language].authorWorkshop}`; }, [language]);
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
