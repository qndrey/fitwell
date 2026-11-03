import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemeMode = "auto" | "light" | "dark";
const THEME_ORDER: ThemeMode[] = ["auto", "light", "dark"];
const THEME_LABEL: Record<ThemeMode, string> = { auto: "Match system", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("fitwell-theme");
      if (stored === "light" || stored === "dark") setMode(stored);
    } catch {
      /* storage blocked: stay on the system theme */
    }
  }, []);

  const choose = (next: ThemeMode) => {
    setMode(next);
    if (next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "auto") window.localStorage.removeItem("fitwell-theme");
      else window.localStorage.setItem("fitwell-theme", next);
    } catch {
      /* ignore */
    }
  };

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length] ?? "auto";
  return (
    <button
      type="button"
      onClick={() => choose(next)}
      aria-label={`Colour theme: ${THEME_LABEL[mode]}. Switch to ${THEME_LABEL[next]}.`}
      title={`Theme: ${THEME_LABEL[mode]}`}
      className="inline-flex size-9 items-center justify-center rounded-full border hover:bg-card"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
