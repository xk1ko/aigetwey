"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeCtx);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const t = stored === "light" ? "light" : "dark";
    setTheme(t);
    document.documentElement.className = document.documentElement.className.replace(/\b(dark|light)\b/g, "").trim() + " " + t;
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      document.documentElement.className = document.documentElement.className.replace(/\b(dark|light)\b/g, "").trim() + " " + next;
      return next;
    });
  }, []);

  return <ThemeCtx value={{ theme, toggle }}>{children}</ThemeCtx>;
}
