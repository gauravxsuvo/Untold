"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isTheme, themeColors, themeCookieName, type Theme } from "@/lib/ui/theme";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", themeColors[theme]);
  }
}

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme | null;
  children: React.ReactNode;
}) {
  const [theme, updateTheme] = useState<Theme>(initialTheme ?? "light");

  const setTheme = useCallback((value: Theme) => {
    if (!isTheme(value)) return;
    updateTheme(value);
    applyTheme(value);
    // This cookie is an appearance preference, never account or message data.
    // biome-ignore lint/suspicious/noDocumentCookie: Safari versions without Cookie Store need this cookie for the saved theme to render before hydration.
    document.cookie = `${themeCookieName}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try {
      localStorage.setItem(themeCookieName, value);
    } catch {
      /* Private browsing may block storage. */
    }
  }, []);

  useEffect(() => {
    let stored: string | null = initialTheme;
    if (!stored) {
      try {
        stored = localStorage.getItem(themeCookieName);
      } catch {
        /* Use device appearance. */
      }
    }
    const preferred = isTheme(stored)
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    updateTheme(preferred);
    applyTheme(preferred);
    const onStorage = (event: StorageEvent) => {
      if (event.key === themeCookieName && isTheme(event.newValue)) setTheme(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [initialTheme, setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}
