import type { FileDiff } from "../../types/diff";

interface ImageDiffProps {
  file: FileDiff;
  sessionId: string;
}

export function ImageDiff({ file, sessionId }: ImageDiffProps) {
  const { status, oldPath, newPath } = file;

  const currentImageUrl = `/api/sessions/${sessionId}/image?file=${encodeURIComponent(newPath)}`;
  const gitImageUrl = `/api/sessions/${sessionId}/image/git?file=${encodeURIComponent(oldPath)}&ref=HEAD`;

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
            src={gitImageUrl}
            alt={`Deleted: ${oldPath}`}
            className="max-w-full max-h-[400px] object-contain rounded opacity-70"
          />
        </div>
      </div>
    );
  }

  // Modified: side-by-side comparison
  return (
    <div className="p-4">
      <div className="flex gap-4 max-md:flex-col">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">Before</div>
          <div className="flex items-center justify-center p-4 bg-red-500/5 border-2 border-red-500/30 rounded-md">
            <img
              src={gitImageUrl}
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
