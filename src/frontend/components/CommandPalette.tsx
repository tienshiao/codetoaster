import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, TerminalSquare, X } from "lucide-react";
import { useSession } from "../SessionContext";
import { buildSessionSlug } from "../utils/slug";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { sessions, currentSessionId, createSession, closeSession } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "p" && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search for a session to switch to"
    >
      <CommandInput placeholder="Search sessions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Commands">
          <CommandItem
            value="new session"
            onSelect={() => {
              const { id, name } = createSession();
              navigate({
                to: "/sessions/$slug",
                params: { slug: buildSessionSlug({ id, name }) },
              });
              setOpen(false);
            }}
          >
            <Plus className="size-4" />
            <span>New Session</span>
          </CommandItem>
          <CommandItem
            value="close session"
            disabled={!currentSessionId}
            onSelect={() => {
              if (!currentSessionId) return;
              const remaining = sessions.filter((s) => s.id !== currentSessionId);
              closeSession(currentSessionId);
              if (remaining.length > 0) {
                const next = remaining[0]!;
                navigate({
                  to: "/sessions/$slug",
                  params: { slug: buildSessionSlug(next) },
                });
              } else {
                navigate({ to: "/" });
              }
              setOpen(false);
            }}
          >
            <X className="size-4" />
            <span>
              Close Session
              {currentSessionId && !sessions.find((s) => s.id === currentSessionId)?.exited && (
                <span className="text-destructive ml-1">(running)</span>
              )}
            </span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Sessions">
          {sessions.map((session) => (
            <CommandItem
              key={session.id}
              value={`${session.name} ${session.title ?? ""} ${session.id}`}
              onSelect={() => {
                navigate({
                  to: "/sessions/$slug",
                  params: { slug: buildSessionSlug(session) },
                });
                setOpen(false);
              }}
            >
              <TerminalSquare className="size-4" />
              <span>
                {session.name}
                {session.id === currentSessionId && (
                  <span className="text-muted-foreground ml-1">(current)</span>
                )}
              </span>
              {session.title && (
                <span className="text-muted-foreground ml-auto truncate text-xs">
                  {session.title}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
