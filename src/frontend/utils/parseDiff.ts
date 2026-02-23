import type { FileDiff, DiffHunk } from "../types/diff";

// Unescape C-style escapes in git quoted paths
function unescapeGitPath(path: string): string {
  // First, collect and decode octal escape sequences as UTF-8 bytes
  // Git escapes non-ASCII bytes as octal (e.g., \342\200\257 for U+202F narrow no-break space)
  let result = path;

  // Find sequences of octal escapes and decode them as UTF-8
  result = result.replace(/((?:\\[0-7]{3})+)/g, (match) => {
    const bytes = [];
    const octalPattern = /\\([0-7]{3})/g;
    let octalMatch;
    while ((octalMatch = octalPattern.exec(match)) !== null) {
      bytes.push(parseInt(octalMatch[1]!, 8));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  });

  // Handle other common escapes
  return result
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// Parse the "diff --git a/X b/Y" header line
// Handles: quoted paths, paths with spaces (when old==new), regular paths
function parseGitDiffHeader(line: string): { oldPath: string; newPath: string } | null {
  const afterPrefix = line.slice("diff --git ".length);

  // Check for quoted paths: "a/path" "b/path"
  const quotedMatch = afterPrefix.match(/^"a\/(.+)" "b\/(.+)"$/);
  if (quotedMatch) {
    return {
      oldPath: unescapeGitPath(quotedMatch[1]!),
      newPath: unescapeGitPath(quotedMatch[2]!),
    };
  }

  // Unquoted paths: a/path b/path
  if (afterPrefix.startsWith("a/")) {
    const rest = afterPrefix.slice(2); // Remove "a/"

    // For same-name files (most common): format is "path b/path"
    // Total length = pathLen + 3 (" b/") + pathLen = 2*pathLen + 3
    const len = rest.length;
    if ((len - 3) > 0 && (len - 3) % 2 === 0) {
      const pathLen = (len - 3) / 2;
      const path1 = rest.slice(0, pathLen);
      const separator = rest.slice(pathLen, pathLen + 3);
      const path2 = rest.slice(pathLen + 3);

      if (separator === " b/" && path1 === path2) {
        return { oldPath: path1, newPath: path2 };
      }
    }

    // Fallback: simple split on " b/" (works for paths without spaces or renames)
    const splitIndex = rest.lastIndexOf(" b/");
    if (splitIndex !== -1) {
      return {
        oldPath: rest.slice(0, splitIndex),
        newPath: rest.slice(splitIndex + 3),
      };
    }
  }

  return null;
}

// Parse "--- a/path" or "+++ b/path" lines, handling quoted paths
function parseDiffPathLine(line: string, prefix: string): string {
  const content = line.slice(prefix.length);
  // Check for quoted path
  if (content.startsWith('"') && content.endsWith('"')) {
    return unescapeGitPath(content.slice(1, -1).replace(/^[ab]\//, ""));
  }
  return content.replace(/^[ab]\//, "");
}

// Image file extensions
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "tif"
]);

function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

export function parseDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split("\n");
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // New file diff header - extract paths from header as fallback
    if (line.startsWith("diff --git")) {
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
        }
        // Set status if not already set (for empty files without ---/+++ lines)
        if (!currentFile.status) {
          if (currentFile.oldPath === "dev/null" || currentFile.oldPath === "/dev/null") {
            currentFile.status = "added";
          } else if (currentFile.newPath === "dev/null" || currentFile.newPath === "/dev/null") {
            currentFile.status = "deleted";
            currentFile.newPath = currentFile.oldPath;
          } else {
            currentFile.status = "modified";
          }
        }
        files.push(currentFile);
      }

      // Extract paths from "diff --git a/oldPath b/newPath"
      const parsed = parseGitDiffHeader(line);
      currentFile = {
        oldPath: parsed?.oldPath ?? "",
        newPath: parsed?.newPath ?? "",
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;

    // Detect new file mode (for empty new files without ---/+++ lines)
    if (line.startsWith("new file mode")) {
      currentFile.status = "added";
      continue;
    }

    // Detect deleted file mode (for empty deleted files without ---/+++ lines)
    if (line.startsWith("deleted file mode")) {
      currentFile.status = "deleted";
      continue;
    }

    // Detect binary files
    if (line.startsWith("Binary files")) {
      currentFile.isBinary = true;
      // Check if it's an image file based on the path
      const filePath = currentFile.newPath || currentFile.oldPath;
      if (filePath && isImageFile(filePath)) {
        currentFile.isImage = true;
      }
      continue;
    }

    // Old file path
    if (line.startsWith("--- ")) {
      currentFile.oldPath = parseDiffPathLine(line, "--- ");
      continue;
    }

    // New file path
    if (line.startsWith("+++ ")) {
      currentFile.newPath = parseDiffPathLine(line, "+++ ");

      // Determine file status and handle special paths
      if (currentFile.newPath === "/dev/null") {
        // Deleted file: use oldPath as the display path
        currentFile.status = "deleted";
        currentFile.newPath = currentFile.oldPath;
      } else if (currentFile.oldPath === "/dev/null") {
        // Added file
        currentFile.status = "added";
      } else {
        // Modified file
        currentFile.status = "modified";
      }
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      oldLineNum = parseInt(hunkMatch[1]!, 10);
      newLineNum = parseInt(hunkMatch[3]!, 10);
      currentHunk = {
        header: line,
        oldStart: oldLineNum,
        oldCount: parseInt(hunkMatch[2] || "1", 10),
        newStart: newLineNum,
        newCount: parseInt(hunkMatch[4] || "1", 10),
        lines: [],
      };
      currentHunk.lines.push({
        type: "hunk-header",
        content: hunkMatch[5] || "",
      });
      continue;
    }

    if (!currentHunk) continue;

    // Diff lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "addition",
        content: line.slice(1),
        newLineNum: newLineNum++,
      });
      currentFile.additions++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "deletion",
        content: line.slice(1),
        oldLineNum: oldLineNum++,
      });
      currentFile.deletions++;
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    }
  }

  // Push last file and hunk
  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    // Set status if not already set (for empty files without ---/+++ lines)
    if (!currentFile.status) {
      if (currentFile.oldPath === "dev/null" || currentFile.oldPath === "/dev/null") {
        currentFile.status = "added";
      } else if (currentFile.newPath === "dev/null" || currentFile.newPath === "/dev/null") {
        currentFile.status = "deleted";
        currentFile.newPath = currentFile.oldPath;
      } else {
        currentFile.status = "modified";
      }
    }
    files.push(currentFile);
  }

  return files;
}
