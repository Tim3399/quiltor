import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { PRODUCT_NAME } from '../config/branding';
import { de } from './de';
import { en } from './en';

export type Language = 'de' | 'en';
export const interfaceLanguageStorageKey = 'quiltor-interface-language';

export const languages = { de, en } as const;

export type MessageKey = keyof typeof de;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: Translate } | null>(null);

function translate(language: Language, key: MessageKey, params?: Record<string, string | number>) {
  const message: string = languages[language][key];
  if (!params) return message;
  return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), message);
}

export function readInterfaceLanguage(): Language {
  const stored = localStorage.getItem(interfaceLanguageStorageKey) ?? localStorage.getItem('writer-language');
  return stored === 'en' ? 'en' : 'de';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(readInterfaceLanguage);
  useEffect(() => {
    localStorage.setItem(interfaceLanguageStorageKey, language);
    localStorage.removeItem('writer-language');
    document.documentElement.lang = language;
    document.title = `${PRODUCT_NAME} · ${languages[language].authorWorkshop}`;
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t: (key: MessageKey, params?: Record<string, string | number>) => translate(language, key, params) }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used within LanguageProvider');
  return value;
}
