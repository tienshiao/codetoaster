import { useState } from "react";
import { Monitor, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { useTerminalTheme, terminalThemeNames } from "../hooks/use-terminal-theme";
import { SidebarFooter } from "./ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const themeOptions = [
  { value: "system" as const, label: "System", icon: Monitor },
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

export function SettingsFooter() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { themeName, setThemeName, theme: terminalTheme } = useTerminalTheme();

  return (
    <SidebarFooter className="border-t border-sidebar-border p-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-zinc-500"
        onClick={() => setOpen(true)}
      >
        <Settings className="size-4" />
        Settings
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
              <div>
                <label className="text-sm font-medium">Theme</label>
                <p className="text-xs text-muted-foreground">Controls the app's light and dark appearance</p>
              </div>
              <div className="flex gap-1">
                {themeOptions.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant="outline"
                    size="sm"
                    className={`flex-1 gap-1.5 ${theme === value ? "border-primary bg-accent" : ""}`}
                    onClick={() => setTheme(value)}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
              <div>
                <label className="text-sm font-medium">Terminal Theme</label>
                <p className="text-xs text-muted-foreground">Color scheme for the terminal emulator</p>
              </div>
              <div className="space-y-2">
                <Select value={themeName || "default"} onValueChange={(v) => setThemeName(v === "default" ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    {terminalThemeNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {terminalTheme && (
                  <div className="flex gap-1.5 pt-1">
                    {[
                      terminalTheme.background,
                      terminalTheme.foreground,
                      terminalTheme.black,
                      terminalTheme.red,
                      terminalTheme.green,
                      terminalTheme.yellow,
                      terminalTheme.blue,
                      terminalTheme.magenta,
                      terminalTheme.cyan,
                      terminalTheme.white,
                    ].map((color, i) => (
                      <div
                        key={i}
                        className="h-5 w-7 rounded-sm border border-zinc-700"
                        style={{ backgroundColor: color }}
                        title={
                          ["background", "foreground", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"][i]
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarFooter>
  );
}
