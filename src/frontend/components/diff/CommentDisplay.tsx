import ReactMarkdown from "react-markdown";
import { Button } from "../ui/button";
import type { LineComment } from "../../types/diff";

interface CommentDisplayProps {
  comment: LineComment;
  commentKey: string;
  onEdit: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  isDeleteConfirm: boolean;
  variant?: "line" | "file";
}

export function CommentDisplay({
  comment,
  onEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  isDeleteConfirm,
  variant = "line",
}: CommentDisplayProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const inner = (
    <div className="border border-border rounded-md bg-card p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">
          {comment.updatedAt !== comment.createdAt ? "edited " : ""}
          {formatTime(comment.updatedAt)}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-destructive hover:text-destructive" onClick={onRequestDelete}>
            Delete
          </Button>
        </div>
      </div>
      {isDeleteConfirm && (
        <div className="flex items-center gap-2 py-1 px-2 mb-2 rounded bg-destructive/10 text-sm">
          <span>Delete this comment?</span>
          <Button variant="destructive" size="sm" className="h-6 text-xs px-2" onClick={onConfirmDelete}>
            Delete
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onCancelDelete}>
            Cancel
          </Button>
        </div>
      )}
      <div className="prose prose-sm prose-invert max-w-none text-sm [&_p]:my-1 [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs">
        <ReactMarkdown>{comment.content}</ReactMarkdown>
      </div>
    </div>
  );

  if (variant === "file") {
    return <div className="mx-4 my-2">{inner}</div>;
  }

  return (
    <tr className="comment-display-row">
      <td colSpan={3} className="p-2 font-sans">
        <div className="sticky left-0 max-w-[100cqi]">
          {inner}
        </div>
      </td>
    </tr>
  );
}
