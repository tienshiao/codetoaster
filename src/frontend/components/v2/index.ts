// The v2 component layer, ported from the "CodeToaster v2 Design System" Claude
// Design project. Icons are lucide components, not names, so call sites take a
// `LucideIcon` — re-exported here rather than reached for out of lucide-react.
export type { LucideIcon } from "lucide-react";

export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";

export { IconButton } from "./IconButton";
export type { IconButtonProps, IconButtonSize } from "./IconButton";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";

export { KeyHint } from "./KeyHint";
export type { KeyHintProps } from "./KeyHint";

export { StatusDot } from "./StatusDot";
export type { StatusDotProps, TaskState } from "./StatusDot";

export { FilterInput } from "./FilterInput";
export type { FilterInputProps } from "./FilterInput";

export { TextInput } from "./TextInput";
export type { TextInputProps } from "./TextInput";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { Select } from "./Select";
export type { SelectOption, SelectProps, SelectSize } from "./Select";

export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";

export { TaskRow } from "./TaskRow";
export type { TaskRowProps } from "./TaskRow";

export { ProjectGroup } from "./ProjectGroup";
export type { ProjectGroupProps } from "./ProjectGroup";

export { Tab, TabStrip, TAB_KINDS } from "./TabStrip";
export type { TabKind, TabProps, TabStripProps } from "./TabStrip";

export { TaskHeader } from "./TaskHeader";
export type { TaskHeaderProps } from "./TaskHeader";

// Kept because the design system owns it, though the shell navigates the
// Explorer from the rail instead — a rail and a row of tabs over the same four
// sections is the same control twice.
export { ExplorerTabs } from "./ExplorerTabs";
export type { ExplorerTabItem, ExplorerTabsProps } from "./ExplorerTabs";

export { ExplorerRail } from "./ExplorerRail";
export type { ExplorerRailItem, ExplorerRailProps } from "./ExplorerRail";

export { StatusBar } from "./StatusBar";
export type { StatusBarProps } from "./StatusBar";

export { DiffStat } from "./DiffStat";
export type { DiffStatProps } from "./DiffStat";

export { FileRow } from "./FileRow";
export type { FileRowProps, FileStatus } from "./FileRow";

export { AppShell, SectionLabel } from "./AppShell";
export type {
  AppShellProps,
  ShellBreadcrumb,
  ShellTab,
  ShellTask,
  ShellTaskGroup,
} from "./AppShell";
