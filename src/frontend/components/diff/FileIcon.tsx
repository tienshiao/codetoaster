import {
  File,
  FileCode,
  FileCode2,
  FileJson,
  FileText,
  FileType,
  Folder,
  Image,
  Settings,
} from "lucide-react";

interface FileIconProps {
  filename: string;
  isFolder: boolean;
}

const ICON_SIZE = 14;

export function FileIcon({ filename, isFolder }: FileIconProps) {
  if (isFolder) {
    return <Folder size={ICON_SIZE} className="text-yellow-500" />;
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "ts":
    case "tsx":
      return <FileCode2 size={ICON_SIZE} className="text-blue-400" />;

    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <FileCode size={ICON_SIZE} className="text-yellow-400" />;

    case "json":
      return <FileJson size={ICON_SIZE} className="text-green-400" />;

    case "css":
    case "scss":
    case "sass":
    case "less":
      return <FileType size={ICON_SIZE} className="text-purple-400" />;

    case "md":
    case "mdx":
    case "txt":
      return <FileText size={ICON_SIZE} className="text-muted-foreground" />;

    case "html":
    case "htm":
      return <FileCode size={ICON_SIZE} className="text-orange-400" />;

    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return <Image size={ICON_SIZE} className="text-pink-400" />;

    case "yaml":
    case "yml":
    case "toml":
    case "ini":
    case "env":
    case "gitignore":
    case "editorconfig":
      return <Settings size={ICON_SIZE} className="text-muted-foreground" />;

    default:
      return <File size={ICON_SIZE} className="text-muted-foreground" />;
  }
}
