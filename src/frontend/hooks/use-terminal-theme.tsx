import { createContext, useContext, useState, type ReactNode } from "react";
import themes from "xterm-theme";
import type { ITheme } from "@xterm/xterm";

export const terminalThemeNames: string[] = Object.keys(themes).sort();

export const terminalFontOptions = [
  { value: "JetBrainsMono", label: "JetBrains Mono", cssFamily: '"JetBrainsMono Nerd Font Mono", monospace' },
  { value: "FiraCode", label: "Fira Code", cssFamily: '"FiraCode Nerd Font Mono", monospace' },
  { value: "Hack", label: "Hack", cssFamily: '"Hack Nerd Font Mono", monospace' },
  { value: "MesloLGS", label: "MesloLGS", cssFamily: '"MesloLGS Nerd Font Mono", monospace' },
  { value: "CaskaydiaCove", label: "Cascadia Code", cssFamily: '"CaskaydiaCove Nerd Font Mono", monospace' },
] as const;

interface TerminalThemeContextValue {
  themeName: string;
  setThemeName: (name: string) => void;
  fontFamily: string;
  setFontFamily: (value: string) => void;
  fontSize: number;
  setFontSize: (value: number) => void;
}

const TerminalThemeContext = createContext<TerminalThemeContextValue | null>(null);

export function TerminalThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState(
    () => localStorage.getItem("terminal-theme") ?? "",
  );

  const [fontFamily, setFontFamilyState] = useState(
    () => localStorage.getItem("terminal-font") ?? "",
  );

  const [fontSize, setFontSizeState] = useState(
    () => Number(localStorage.getItem("terminal-font-size")) || 0,
  );

  const setThemeName = (name: string) => {
    setThemeNameState(name);
    if (name) {
      localStorage.setItem("terminal-theme", name);
    } else {
      localStorage.removeItem("terminal-theme");
    }
  };

  const setFontFamily = (value: string) => {
    setFontFamilyState(value);
    if (value) {
      localStorage.setItem("terminal-font", value);
    } else {
      localStorage.removeItem("terminal-font");
    }
  };

  const setFontSize = (value: number) => {
    setFontSizeState(value);
    if (value) {
      localStorage.setItem("terminal-font-size", String(value));
    } else {
      localStorage.removeItem("terminal-font-size");
    }
  };

  return (
    <TerminalThemeContext.Provider value={{ themeName, setThemeName, fontFamily, setFontFamily, fontSize, setFontSize }}>
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
  const fontOption = terminalFontOptions.find((f) => f.value === ctx.fontFamily);
  const cssFontFamily = fontOption ? fontOption.cssFamily : "monospace";
  return {
    themeName: ctx.themeName,
    setThemeName: ctx.setThemeName,
    theme,
    fontFamily: ctx.fontFamily,
    setFontFamily: ctx.setFontFamily,
    cssFontFamily,
    fontSize: ctx.fontSize,
    setFontSize: ctx.setFontSize,
  };
}
