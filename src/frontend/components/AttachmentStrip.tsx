import { FileText, X } from "lucide-react";
import { IconButton } from "@/frontend/components/v2/IconButton";
import { cn } from "@/frontend/lib/utils";
import { formatSize } from "@/frontend/utils/formatSize";
import { generateUUID } from "@/frontend/utils/uuid";

/** A file the composer is holding until submit (TASK-93). Nothing is uploaded
 * while it sits here, so this is the only copy of it — and `previewUrl` is an
 * object URL this module minted, which the holder has to release. */
export interface Attachment {
  id: string;
  file: File;
  /** A thumbnail source, for an image. Undefined for everything else, which
   * gets an icon rather than a broken picture. */
  previewUrl?: string;
}

export function toAttachment(file: File): Attachment {
  return {
    // Not `crypto.randomUUID`: it is undefined on an insecure origin, which is
    // exactly how this UI is reached over plain http on a LAN.
    id: generateUUID(),
    file,
    // Only for an image. A PDF or a log would render as a broken thumbnail,
    // and an object URL for one is a leak with nothing to show for it.
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  };
}

/** The other half of `toAttachment`. An object URL pins its blob in memory for
 * the life of the document, so a composer the user pastes ten screenshots into
 * and then clears keeps all ten until the tab closes. */
export function releaseAttachment(attachment: Attachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

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
