import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "codetoaster";

const Setting = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-2">
    <div>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
    {children}
  </div>
);

// The open stories keep a wider gap under the label: Radix's default
// item-aligned positioning floats the list over the trigger, so a tight gap
// would put the menu on top of the label text.
const OpenSetting = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-4">
    <div>
      <div className="text-sm font-medium text-foreground">{label}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
    {children}
  </div>
);

// The Settings dialog's terminal section: three closed selects with their labels.
export const SettingsRows = () => (
  <div className="flex w-[420px] flex-col gap-4">
    <Setting label="Terminal Font" hint="Font family for the terminal emulator">
      <Select defaultValue="JetBrainsMono">
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="JetBrainsMono">JetBrains Mono</SelectItem>
        </SelectContent>
      </Select>
    </Setting>
    <Setting label="Font Size" hint="Text size in the terminal emulator">
      <Select defaultValue="14">
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="14">14px</SelectItem>
        </SelectContent>
      </Select>
    </Setting>
    <Setting label="Notification Sound" hint="Audible alert for terminal notifications">
      <Select defaultValue="chime">
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="chime">Chime</SelectItem>
        </SelectContent>
      </Select>
    </Setting>
  </div>
);

export const Open = () => (
  <div style={{ paddingTop: 168 }} className="w-[420px]">
    <OpenSetting label="Terminal Font" hint="Font family for the terminal emulator">
      <Select defaultValue="default" defaultOpen>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default (monospace)</SelectItem>
          <SelectItem value="JetBrainsMono">JetBrains Mono</SelectItem>
          <SelectItem value="FiraCode">Fira Code</SelectItem>
          <SelectItem value="Hack">Hack</SelectItem>
          <SelectItem value="MesloLGS">MesloLGS</SelectItem>
          <SelectItem value="CaskaydiaCove">Cascadia Code</SelectItem>
        </SelectContent>
      </Select>
    </OpenSetting>
  </div>
);

export const Grouped = () => (
  <div style={{ paddingTop: 168 }} className="w-[420px]">
    <OpenSetting label="Terminal Theme" hint="Color scheme for the terminal emulator">
      <Select defaultValue="default" defaultOpen>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Dark</SelectLabel>
            <SelectItem value="Dracula">Dracula</SelectItem>
            <SelectItem value="Tomorrow Night">Tomorrow Night</SelectItem>
            <SelectItem value="Nord">Nord</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Light</SelectLabel>
            <SelectItem value="Solarized Light">Solarized Light</SelectItem>
            <SelectItem value="Github">Github</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </OpenSetting>
  </div>
);

export const TriggerStates = () => (
  <div className="flex w-[420px] flex-col gap-4">
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">Placeholder</span>
      <Select>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a terminal theme" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Dracula">Dracula</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">size="sm"</span>
      <Select defaultValue="Hack">
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Hack">Hack</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">Disabled</span>
      <Select defaultValue="off" disabled>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">Off</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Bell sound follows the notification sound</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">Invalid</span>
      <Select>
        <SelectTrigger aria-invalid className="w-full">
          <SelectValue placeholder="Select a terminal font" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Hack">Hack</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-destructive">Pick a font before saving</p>
    </div>
  </div>
);
