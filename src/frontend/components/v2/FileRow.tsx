import {
  File,
  FileCode,
  FileCode2,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { DiffStat } from "./DiffStat";
import { cn } from "@/frontend/lib/utils";

export type FileStatus = "modified" | "added" | "deleted" | "renamed";

export interface FileRowProps {
  /** File or directory name, not a path — the tree carries the path. */
  name: string;
  /** Present in a diff tree; replaces the type glyph with a status square. */
  status?: FileStatus;
  additions?: number;
  deletions?: number;
  /** Trailing mono annotation, e.g. "renamed". */
  note?: string;
  folder?: boolean;
  open?: boolean;
  depth?: number;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

// File-type glyph + tint, transcribed from the repo's FileIcon.tsx. These are the
// one place the system reaches past the semantic aliases into the raw palette —
// a file type is not a product state, so no semantic name fits.
const EXT_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  ts: { icon: FileCode2, color: "text-[var(--ct-blue-400)]" },
  tsx: { icon: FileCode2, color: "text-[var(--ct-blue-400)]" },
  js: { icon: FileCode, color: "text-[var(--ct-amber-400)]" },
  jsx: { icon: FileCode, color: "text-[var(--ct-amber-400)]" },
  json: { icon: FileJson, color: "text-[var(--ct-green-400)]" },
  css: { icon: FileType, color: "text-[var(--ct-violet-500)]" },
  md: { icon: FileText, color: "text-muted-foreground" },
  txt: { icon: FileText, color: "text-muted-foreground" },
  html: { icon: FileCode, color: "text-[var(--ct-amber-500)]" },
  png: { icon: ImageIcon, color: "text-chart-3" },
  svg: { icon: ImageIcon, color: "text-chart-3" },
  yaml: { icon: Settings, color: "text-muted-foreground" },
  yml: { icon: Settings, color: "text-muted-foreground" },
  toml: { icon: Settings, color: "text-muted-foreground" },
};

const STATUS_FILLS: Record<FileStatus, string> = {
  modified: "bg-state-busy",
  added: "bg-diff-add-marker",
  deleted: "bg-diff-del-marker",
  renamed: "bg-muted-foreground",
};

export function FileRow({
  name,
  status,
  additions,
  deletions,
  note,
  folder = false,
  open = false,
  depth = 0,
  selected = false,
  onClick,
  className,
}: FileRowProps) {
  const ext = String(name).split(".").pop()?.toLowerCase() ?? "";
  const glyph = folder
    ? { icon: open ? FolderOpen : Folder, color: "text-[var(--ct-amber-500)]" }
    : (EXT_ICONS[ext] ?? { icon: File, color: "text-muted-foreground" });
  const Icon = glyph.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      // Indent is 12px per level off an 8px gutter; no spacing step multiplies out.
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        "flex h-row w-full cursor-pointer items-center gap-[7px] rounded-md pr-2 text-left",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        selected ? "bg-selected text-selected-foreground" : "text-foreground hover:bg-hover",
        className,
      )}
    >
      {status ? (
        <span className={cn("size-2 flex-none rounded-sm", STATUS_FILLS[status])} />
      ) : (
        <Icon size={14} className={cn("flex-none", glyph.color)} />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-mono">{name}</span>
      {note ? (
        <span className="font-mono text-micro tracking-mono text-subtle-foreground">{note}</span>
      ) : null}
      {additions != null || deletions != null ? (
        <DiffStat additions={additions} deletions={deletions} />
      ) : null}
    </button>
  );
}
