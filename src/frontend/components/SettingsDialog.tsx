import { useMemo } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import {
  useTerminalTheme,
  terminalThemeNames,
  terminalThemeSwatches,
  terminalFontOptions,
  TERMINAL_SWATCH_KEYS,
} from "../hooks/use-terminal-theme";
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

/** A theme's palette as a row of colours. Small on a picker row, larger under
 * the setting itself — the same ten colours in the same order either way, so
 * the row you chose and the strip that confirms it are visibly the same thing.
 *
 * The preview shares out the column rather than claiming ten fixed widths.
 * Ten of those came to 334px against a 311px column, and an `fr` track takes
 * its minimum from its content — so the strip was quietly widening the whole
 * second column and leaving this one row's select 23px left of the four under
 * it. `min-w-0` is the other half: without it a flex item will not shrink
 * below its content either. */
function Swatches({ colors, size }: { colors: string[]; size: "row" | "preview" }) {
  return (
    <span className={size === "row" ? "flex gap-px" : "flex gap-1.5 pt-1"}>
      {colors.map((color, i) => (
        <span
          key={i}
          className={
            size === "row"
              ? "h-3 w-1.5 rounded-[1px]"
              : "h-5 min-w-0 flex-1 rounded-sm border border-border"
          }
          // The fill is the terminal palette being previewed — data, not app
          // chrome, so it stays inline.
          style={{ backgroundColor: color }}
          title={size === "preview" ? TERMINAL_SWATCH_KEYS[i] : undefined}
        />
      ))}
    </span>
  );
}

/**
 * The v2 `Select` is a chip sized to its value; these sit in a settings column
 * and want the whole of it, with the chevron at the far edge the way the v1
 * trigger drew it. The trigger's value grows to fill (see `Select`), so the
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

  // 157 themes, each with ten swatches, built once rather than on every
  // keystroke of the picker's filter — the list itself never changes.
  const terminalThemeItems = useMemo(
    () => [
      { value: "default", label: "Default" },
      ...terminalThemeNames.map((name) => {
        const swatches = terminalThemeSwatches(name);
        return {
          value: name,
          label: name,
          trailing: swatches ? <Swatches colors={swatches} size="row" /> : undefined,
        };
      }),
    ],
    [],
  );

  const previewSwatches = terminalTheme
    ? TERMINAL_SWATCH_KEYS.map((key) => (terminalTheme[key] as string | undefined) ?? "transparent")
    : undefined;

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
          <div className="min-w-0 space-y-2">
            <Select
              className={SELECT}
              aria-label="Terminal Theme"
              value={themeName || "default"}
              onValueChange={(value) => setThemeName(value === "default" ? "" : value)}
              // 157 of them, alphabetical, and named things like "Sundried"
              // and "Hivacruz". Without these two the only way to choose was
              // to apply one and look at the strip below.
              filterPlaceholder="Type to filter"
              options={terminalThemeItems}
            />
            {previewSwatches ? <Swatches colors={previewSwatches} size="preview" /> : null}
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
            onValueChange={(value) => setFontFamily(value === "default" ? "" : value)}
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
            onValueChange={(value) => setFontSize(Number(value))}
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
            onValueChange={(value) => {
              setSoundOption(value as typeof soundOption);
              previewSound(value as typeof soundOption);
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
            onValueChange={(value) => {
              setBellOption(value as typeof bellOption);
              previewBell(value as typeof bellOption);
            }}
            options={[...SOUND_OPTIONS]}
          />
        </div>
      </div>
    </Dialog>
  );
}
