import { createContext, useContext, useState, type ReactNode } from "react";
import themes from "xterm-theme";
import type { ITheme } from "@xterm/xterm";

export const terminalThemeNames: string[] = Object.keys(themes).sort();

interface TerminalThemeContextValue {
  themeName: string;
  setThemeName: (name: string) => void;
}

const TerminalThemeContext = createContext<TerminalThemeContextValue | null>(null);

export function TerminalThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState(
    () => localStorage.getItem("terminal-theme") ?? "",
  );

  const setThemeName = (name: string) => {
    setThemeNameState(name);
    if (name) {
      localStorage.setItem("terminal-theme", name);
    } else {
      localStorage.removeItem("terminal-theme");
    }
  };

  return (
    <TerminalThemeContext.Provider value={{ themeName, setThemeName }}>
      {children}
    </TerminalThemeContext.Provider>
  );
}

export function useTerminalTheme() {
  const ctx = useContext(TerminalThemeContext);
  if (!ctx) throw new Error("useTerminalTheme must be used within TerminalThemeProvider");
  const theme: ITheme | undefined = ctx.themeName
    ? (themes as Record<string, ITheme>)[ctx.themeName]
    : undefined;
  return { themeName: ctx.themeName, setThemeName: ctx.setThemeName, theme };
}
