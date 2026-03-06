export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  depth: number;
}

export type FileContentResponse =
  | {
      isBinary: true;
      isImage: boolean;
      size?: number;
    }
  | {
      isBinary: false;
      isImage: false;
      lines: { lineNum: number; content: string }[];
      totalLines: number;
      size?: number;
    };

export interface FilesResponse {
  files: FileInfo[];
  directory: string;
}
