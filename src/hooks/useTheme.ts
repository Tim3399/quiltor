import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function useTheme() {
  const [system, setSystem] = useState<Theme>(systemTheme);
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem("quiltor-theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const theme = preference === "system" ? system : preference;
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("quiltor-theme", preference);
  }, [theme, preference]);
  return {
    theme,
    preference,
    setPreference,
    toggleTheme: () => setPreference(theme === "light" ? "dark" : "light"),
  };
}
