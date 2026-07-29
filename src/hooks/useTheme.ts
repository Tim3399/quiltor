import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const systemTheme = (): Theme => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('quiltor-theme');
    return stored === 'light' || stored === 'dark' ? stored : systemTheme();
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('quiltor-theme', theme);
  }, [theme]);
  return { theme, toggleTheme: () => setTheme(value => value === 'light' ? 'dark' : 'light') };
}
