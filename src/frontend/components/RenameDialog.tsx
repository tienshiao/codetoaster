import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

interface RenameDialogProps {
  item: { id: string; name: string } | null;
  title: string;
  onRename: (id: string, name: string) => void;
  onClose: () => void;
}

export function RenameDialog({
  item,
  title,
  onRename,
  onClose,
}: RenameDialogProps) {
  const [renameName, setRenameName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item) {
      setRenameName(item.name);
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [item?.id]);

  const handleSubmit = () => {
    const trimmed = renameName.trim();
    if (item && trimmed && trimmed !== item.name) {
      onRename(item.id, trimmed);
    }
    onClose();
  };

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <Input
            ref={renameInputRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Name"
            data-1p-ignore
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!renameName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
