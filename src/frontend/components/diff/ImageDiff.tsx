import type { FileDiff } from "../../types/diff";

interface ImageDiffProps {
  file: FileDiff;
  sessionId: string;
  // When present (git commit view) both sides are read from git at these full
  // SHAs (old = first parent, new = the commit). When absent (working-tree diff)
  // the "after" side is the file on disk and "before" comes from HEAD.
  imageRefs?: { old: string; new: string };
}

export function ImageDiff({ file, sessionId, imageRefs }: ImageDiffProps) {
  const { status, oldPath, newPath } = file;

  const gitUrl = (path: string, ref: string) =>
    `/api/sessions/${sessionId}/image/git?file=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`;

  // "after"/new side.
  const currentImageUrl = imageRefs
    ? gitUrl(newPath, imageRefs.new)
    : `/api/sessions/${sessionId}/image?file=${encodeURIComponent(newPath)}`;
  // "before"/old side.
  const beforeImageUrl = imageRefs
    ? gitUrl(oldPath, imageRefs.old)
    : gitUrl(oldPath, "HEAD");

  if (status === "added") {
    return (
      <div className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-green-500 mb-2">Added</div>
        <div className="flex items-center justify-center p-4 bg-green-500/5 border-2 border-green-500/30 rounded-md">
          <img
            src={currentImageUrl}
            alt={`Added: ${newPath}`}
            className="max-w-full max-h-[400px] object-contain rounded"
          />
        </div>
      </div>
    );
  }

  if (status === "deleted") {
    return (
      <div className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">Deleted</div>
        <div className="flex items-center justify-center p-4 bg-red-500/5 border-2 border-red-500/30 rounded-md">
          <img
            src={beforeImageUrl}
            alt={`Deleted: ${oldPath}`}
            className="max-w-full max-h-[400px] object-contain rounded opacity-70"
          />
        </div>
      </div>
    );
  }

  // Modified / renamed / copied: side-by-side comparison.
  const renameLabel =
    (status === "renamed" || status === "copied") && oldPath !== newPath
      ? status === "copied"
        ? "Copied"
        : "Renamed"
      : null;

  return (
    <div className="p-4">
      {renameLabel && (
        <div className="mb-2 flex items-center gap-2 text-xs font-mono">
          <span className="font-semibold uppercase tracking-wide text-purple-400">{renameLabel}</span>
          <span className="truncate text-muted-foreground">
            {oldPath} <span className="text-muted-foreground/60">→</span> {newPath}
          </span>
        </div>
      )}
      <div className="flex gap-4 max-md:flex-col">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">Before</div>
          <div className="flex items-center justify-center p-4 bg-red-500/5 border-2 border-red-500/30 rounded-md">
            <img
              src={beforeImageUrl}
              alt={`Before: ${oldPath}`}
              className="max-w-full max-h-[400px] object-contain rounded"
            />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-green-500 mb-2">After</div>
          <div className="flex items-center justify-center p-4 bg-green-500/5 border-2 border-green-500/30 rounded-md">
            <img
              src={currentImageUrl}
              alt={`After: ${newPath}`}
              className="max-w-full max-h-[400px] object-contain rounded"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
