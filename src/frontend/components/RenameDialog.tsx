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
    // No "unchanged" short-circuit: the field is seeded with the label on
    // screen, which for a session showing its terminal title is not the stored
    // name. Confirming that seed unedited is exactly how you pin the current
    // title as the name, so it has to reach onRename.
    const trimmed = renameName.trim();
    if (item && trimmed) {
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
