import { FileText, X } from "lucide-react";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { cn } from "@/frontend/lib/utils";
import { formatSize } from "@/frontend/utils/formatSize";
import type { Attachment } from "@/frontend/lib/attachments";

export interface AttachmentStripProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  /** Removal is off while the upload is in flight: the files have already been
   * handed to `uploadStaged` and the prompt is being built from what came
   * back, so taking one out of the list now changes neither. */
  disabled?: boolean;
  className?: string;
}

/**
 * The attached files, between the prompt and the options row.
 *
 * Chips rather than a list, because they sit in the same visual register as
 * the option chips below them and there are rarely more than a handful. A
 * thumbnail where there is one to show: the case this whole feature is for is
 * a pasted screenshot, and "screenshot 2026-09-06 at 14.22.13.png" is not a
 * name anybody recognises their own screenshot by.
 */
export function AttachmentStrip({
  attachments,
  onRemove,
  disabled = false,
  className,
}: AttachmentStripProps) {
  if (attachments.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Attachments">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className={cn(
            "flex max-w-[220px] items-center gap-1.5 rounded-md border border-input bg-pane",
            "h-control py-0 pl-1.5 pr-1 text-sm text-foreground",
          )}
        >
          {attachment.previewUrl ? (
            <img
              src={attachment.previewUrl}
              alt=""
              className="size-4 flex-none rounded-sm object-cover"
            />
          ) : (
            <FileText size={13} className="flex-none text-muted-foreground" />
          )}
          <span className="truncate" title={attachment.file.name}>
            {attachment.file.name}
          </span>
          <span className="flex-none text-xs text-muted-foreground">
            {formatSize(attachment.file.size)}
          </span>
          <IconButton
            icon={X}
            label={`Remove ${attachment.file.name}`}
            size="sm"
            disabled={disabled}
            onClick={() => onRemove(attachment.id)}
            className="size-[18px]"
          />
        </li>
      ))}
    </ul>
  );
}
