import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { useTerminalTheme, terminalThemeNames, terminalFontOptions } from "../hooks/use-terminal-theme";
import { useNotificationSound, useBellSound, SOUND_OPTIONS } from "../hooks/use-notification-sound";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { Button } from "@/frontend/components/v2/Button";
import { Select } from "@/frontend/components/v2/Select";

const themeOptions = [
  { value: "system" as const, label: "System", icon: Monitor },
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

const fontSizeOptions = [
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
];

const swatchNames = [
  "background",
  "foreground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

/**
 * The v2 `Select` is a chip sized to its value; these sit in a settings column
 * and want the whole of it, with the chevron at the far edge the way the v1
 * trigger drew it. The inner `<select>` grows to fill (see `Select`), so the
 * chevron lands at the trailing edge without a `justify-between` that would
 * leave the space between them dead to a click.
 */
const SELECT = "w-full";

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
 *
 * No `onConfirm`, so the dialog is dismiss-only: every control below writes its
 * own change the moment it is touched, which leaves Save nothing to do and
 * Cancel nothing to undo.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme();
  const { themeName, setThemeName, theme: terminalTheme, fontFamily, setFontFamily, fontSize, setFontSize } = useTerminalTheme();
  const { soundOption, setSoundOption, previewSound } = useNotificationSound();
  const { soundOption: bellOption, setSoundOption: setBellOption, previewSound: previewBell } = useBellSound();

  return (
    <Dialog
      open={open}
      title="Settings"
      // Everything here is per-device, which is not obvious from a list of
      // dropdowns.
      description="Appearance and sounds, remembered on this device."
      onClose={() => onOpenChange(false)}
      // The panel is `max-w-sm` by default and grows to its content; both are
      // wrong for a six-row form, and without the height cap the body below has
      // nothing to scroll inside.
      className="sm:max-w-xl max-h-[calc(100dvh-2rem)]"
    >
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
                // `outline` carries `hover:bg-hover hover:border-border-strong`,
                // and a hover variant is a different tailwind-merge group from
                // the base one — so without restating them the selected button
                // sheds both its fill and its border under the cursor, i.e. the
                // one row you point at stops looking selected.
                className={`flex-1 gap-1.5 ${
                  theme === value
                    ? "border-selected-border bg-selected text-selected-foreground hover:border-selected-border hover:bg-selected"
                    : ""
                }`}
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
            <Select
              className={SELECT}
              aria-label="Terminal Theme"
              value={themeName || "default"}
              onChange={(e) => setThemeName(e.target.value === "default" ? "" : e.target.value)}
              options={[
                { value: "default", label: "Default" },
                ...terminalThemeNames.map((name) => ({ value: name, label: name })),
              ]}
            />
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
                    className="h-5 w-7 rounded-sm border border-border"
                    // The fill is the terminal palette being previewed — data,
                    // not app chrome, so it stays inline.
                    style={{ backgroundColor: color }}
                    title={swatchNames[i]}
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
          <Select
            className={SELECT}
            aria-label="Terminal Font"
            value={fontFamily || "default"}
            onChange={(e) => setFontFamily(e.target.value === "default" ? "" : e.target.value)}
            options={[
              { value: "default", label: "Default (monospace)" },
              ...terminalFontOptions.map((font) => ({ value: font.value, label: font.label })),
            ]}
          />
        </div>
        <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
          <div>
            <label className="text-sm font-medium">Font Size</label>
            <p className="text-xs text-muted-foreground">Text size in the terminal emulator</p>
          </div>
          <Select
            className={SELECT}
            aria-label="Font Size"
            value={String(fontSize || 0)}
            onChange={(e) => setFontSize(Number(e.target.value))}
            options={fontSizeOptions}
          />
        </div>
        <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
          <div>
            <label className="text-sm font-medium">Notification Sound</label>
            <p className="text-xs text-muted-foreground">Audible alert for terminal notifications</p>
          </div>
          <Select
            className={SELECT}
            aria-label="Notification Sound"
            value={soundOption}
            onChange={(e) => {
              const value = e.target.value as typeof soundOption;
              setSoundOption(value);
              previewSound(value);
            }}
            options={[...SOUND_OPTIONS]}
          />
        </div>
        <div className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-2 items-start">
          <div>
            <label className="text-sm font-medium">Bell Sound</label>
            <p className="text-xs text-muted-foreground">Audible alert for terminal bell (BEL character)</p>
          </div>
          <Select
            className={SELECT}
            aria-label="Bell Sound"
            value={bellOption}
            onChange={(e) => {
              const value = e.target.value as typeof bellOption;
              setBellOption(value);
              previewBell(value);
            }}
            options={[...SOUND_OPTIONS]}
          />
        </div>
      </div>
    </Dialog>
  );
}
