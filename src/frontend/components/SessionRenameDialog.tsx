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
import { sessionDisplayName } from "../../lib/xtmux/naming";

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
      // Seed with the label on screen, not the stored name: renaming a session
      // showing a live title should start from that title, not from the
      // "<dir> · <branch>" fallback the title is currently covering.
      setRenameName(sessionDisplayName(session));
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [session]);

  const handleSubmit = () => {
    const trimmed = renameName.trim();
    if (session && trimmed && trimmed !== sessionDisplayName(session)) {
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
