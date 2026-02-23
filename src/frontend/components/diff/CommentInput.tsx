import { useState, useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface CommentInputProps {
  initialContent?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  variant?: "line" | "file";
}

export function CommentInput({ initialContent, onSave, onCancel, variant = "line" }: CommentInputProps) {
  const [content, setContent] = useState(initialContent || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      if (content.trim()) {
        onSave(content);
      }
    }
  };

  const inner = (
    <div className="border border-border rounded-md bg-card p-3">
      <Textarea
        ref={textareaRef}
        className="resize-y min-h-[72px] text-sm"
        placeholder={variant === "file" ? "Leave a comment on this file..." : "Leave a comment..."}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(content)}
          disabled={!content.trim()}
        >
          Add comment
        </Button>
      </div>
    </div>
  );

  if (variant === "file") {
    return <div className="mx-4 my-2">{inner}</div>;
  }

  return (
    <tr className="comment-input-row">
      <td colSpan={3} className="p-2 font-sans">
        <div className="sticky left-0 max-w-[100cqi]">
          {inner}
        </div>
      </td>
    </tr>
  );
}
