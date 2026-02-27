import { useState } from "react";
import { Monitor, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { useTerminalTheme, terminalThemeNames, terminalFontOptions } from "../hooks/use-terminal-theme";
import { useNotificationSound, useBellSound, SOUND_OPTIONS } from "../hooks/use-notification-sound";
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
  const { themeName, setThemeName, theme: terminalTheme, fontFamily, setFontFamily, fontSize, setFontSize } = useTerminalTheme();
  const { soundOption, setSoundOption, previewSound } = useNotificationSound();
  const { soundOption: bellOption, setSoundOption: setBellOption, previewSound: previewBell } = useBellSound();

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
        <DialogContent className="grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 overflow-y-auto min-h-0">
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
            <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
              <div>
                <label className="text-sm font-medium">Terminal Font</label>
                <p className="text-xs text-muted-foreground">Font family for the terminal emulator</p>
              </div>
              <Select value={fontFamily || "default"} onValueChange={(v) => setFontFamily(v === "default" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default (monospace)</SelectItem>
                  {terminalFontOptions.map((font) => (
                    <SelectItem key={font.value} value={font.value}>
                      {font.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
              <div>
                <label className="text-sm font-medium">Font Size</label>
                <p className="text-xs text-muted-foreground">Text size in the terminal emulator</p>
              </div>
              <Select value={String(fontSize || 0)} onValueChange={(v) => setFontSize(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { value: "0", label: "Default (15)" },
                    { value: "12", label: "12" },
                    { value: "13", label: "13" },
                    { value: "14", label: "14" },
                    { value: "15", label: "15" },
                    { value: "16", label: "16" },
                    { value: "18", label: "18" },
                    { value: "20", label: "20" },
                    { value: "22", label: "22" },
                    { value: "24", label: "24" },
                  ].map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
              <div>
                <label className="text-sm font-medium">Notification Sound</label>
                <p className="text-xs text-muted-foreground">Audible alert for terminal notifications</p>
              </div>
              <Select
                value={soundOption}
                onValueChange={(v) => {
                  setSoundOption(v as typeof soundOption);
                  previewSound(v as typeof soundOption);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOUND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
              <div>
                <label className="text-sm font-medium">Bell Sound</label>
                <p className="text-xs text-muted-foreground">Audible alert for terminal bell (BEL character)</p>
              </div>
              <Select
                value={bellOption}
                onValueChange={(v) => {
                  setBellOption(v as typeof bellOption);
                  previewBell(v as typeof bellOption);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOUND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground text-center pt-2 border-t">
              Press{" "}
              <kbd className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border">
                {typeof navigator !== "undefined" && navigator.platform.includes("Mac") ? "⌘⇧P" : "Ctrl+Shift+P"}
              </kbd>{" "}
              to open the command palette
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarFooter>
  );
}
