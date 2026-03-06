export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  depth: number;
}

export interface FileContentResponse {
  lines: { lineNum: number; content: string }[];
  totalLines: number;
  isBinary: boolean;
  isImage: boolean;
  size?: number;
}

export interface FilesResponse {
  files: FileInfo[];
  directory: string;
}