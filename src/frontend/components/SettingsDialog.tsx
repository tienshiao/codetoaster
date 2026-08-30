import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { useTerminalTheme, terminalThemeNames, terminalFontOptions } from "../hooks/use-terminal-theme";
import { useNotificationSound, useBellSound, SOUND_OPTIONS } from "../hooks/use-notification-sound";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Theme, terminal appearance, and the two sounds.
 *
 * Controlled, and without a trigger of its own: it used to carry a v1 button,
 * but the v2 shell draws that itself in the sidebar footer, and two buttons for
 * one dialog is one too many. Nothing here is about a task — it is all
 * per-device preference in `localStorage` — which is why it survived the v1
 * routes going and only needed reconnecting (TASK-28).
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme();
  const { themeName, setThemeName, theme: terminalTheme, fontFamily, setFontFamily, fontSize, setFontSize } = useTerminalTheme();
  const { soundOption, setSoundOption, previewSound } = useNotificationSound();
  const { soundOption: bellOption, setSoundOption: setBellOption, previewSound: previewBell } = useBellSound();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            {/* Radix wants every dialog described, and warns in the console
                when one is not. It also earns its place: everything here is
                per-device, which is not obvious from a list of dropdowns. */}
            <DialogDescription>
              Appearance and sounds, remembered on this device.
            </DialogDescription>
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
          </div>
      </DialogContent>
    </Dialog>
  );
}
