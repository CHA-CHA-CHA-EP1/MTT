import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "mtt-theme" }
  )
);

export function useTheme() {
  const { theme, setTheme } = useThemeStore();

  useEffect(() => {
    const root = document.documentElement;
    const applyDark = (dark: boolean) => {
      root.classList.toggle("dark", dark);
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyDark(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyDark(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      applyDark(theme === "dark");
    }
  }, [theme]);

  return { theme, setTheme };
}
