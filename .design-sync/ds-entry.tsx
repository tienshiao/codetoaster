// Bundle entry for /design-sync.
//
// CodeToaster is an application, not a published component library, so there is
// no dist/ entry exposing a component surface. This file IS that surface: it
// re-exports the shadcn/ui primitive layer plus the app-level components, and
// `cfg.entry` points the converter at it.
//
// `export *` is deliberate — every compound part (DropdownMenuItem,
// SidebarMenuButton, useSidebar, ...) reaches window.CodeToaster even though
// only the family roots get preview cards. See .design-sync/config.json's
// componentSrcMap for the carded set.

// --- ui/ : shadcn primitives (new-york, zinc, CSS variables) ---
export * from "../src/frontend/components/ui/alert-dialog";
export * from "../src/frontend/components/ui/button";
export * from "../src/frontend/components/ui/collapsible";
export * from "../src/frontend/components/ui/command";
export * from "../src/frontend/components/ui/dialog";
export * from "../src/frontend/components/ui/dropdown-menu";
export * from "../src/frontend/components/ui/input";
export * from "../src/frontend/components/ui/popover";
export * from "../src/frontend/components/ui/select";
export * from "../src/frontend/components/ui/separator";
export * from "../src/frontend/components/ui/sheet";
export * from "../src/frontend/components/ui/sidebar";
export * from "../src/frontend/components/ui/skeleton";
export * from "../src/frontend/components/ui/sonner";
export * from "../src/frontend/components/ui/tabs";
export * from "../src/frontend/components/ui/textarea";
export * from "../src/frontend/components/ui/tooltip";

// --- preview context scaffolding (not design-system API; see preview-context.tsx) ---
export * from "./preview-context";

// --- app-level components ---
export * from "../src/frontend/components/CommandPalette";
export * from "../src/frontend/components/DirectoryPickerDialog";
export * from "../src/frontend/components/FilterInput";
export * from "../src/frontend/components/HelpDialog";
export * from "../src/frontend/components/InitialPathAutocomplete";
export * from "../src/frontend/components/ProjectDialog";
export * from "../src/frontend/components/RenameDialog";
export * from "../src/frontend/components/SettingsDialog";
export * from "../src/frontend/components/StatusDot";
export * from "../src/frontend/components/SymbolPopover";
export * from "../src/frontend/components/TabSwitcher";
export * from "../src/frontend/components/TerminalPreview";
export * from "../src/frontend/components/TerminalSearchBar";
