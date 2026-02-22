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
import type { SessionInfo } from "../SessionContext";

interface SessionRenameDialogProps {
  session: SessionInfo | null;
  onRename: (id: string, name: string) => void;
  onClose: () => void;
}

export function SessionRenameDialog({
  session,
  onRename,
  onClose,
}: SessionRenameDialogProps) {
  const [renameName, setRenameName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session) {
      setRenameName(session.name);
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [session]);

  const handleSubmit = () => {
    const trimmed = renameName.trim();
    if (session && trimmed && trimmed !== session.name) {
      onRename(session.id, trimmed);
    }
    onClose();
  };

  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Session</DialogTitle>
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
            placeholder="Session name"
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
