import type { RepoRoot } from "@/frontend/repo-root";
import { Badge, SectionLabel } from "@/frontend/components/v2";
import { ExplorerError, ExplorerLoading, ExplorerNote } from "@/frontend/components/explorer-notes";
import { useTaskProcesses } from "@/frontend/hooks/use-task-processes";
import type { ProcessInfo } from "@/types/processes";

/**
 * The Explorer's Processes section (TASK-138.1): what is running under the
 * task's terminals, as a tree, and which TCP ports each process listens on.
 *
 * Read-only on purpose. The point is seeing what a fan-out of subagents,
 * dev servers and test runners has left running; stopping one is a signal
 * sent to a process the user has not confirmed is the one they mean, and
 * the terminal it belongs to is a click away.
 */

/** The command a row leads with: the program's file name rather than its
 * path, then its arguments. The full line is the row's `title`. */
export function shortCommand(command: string): string {
  const [program = "", ...args] = command.split(" ");
  const name = program.slice(program.lastIndexOf("/") + 1);
  return [name, ...args].join(" ");
}

const TERMINAL_LABEL: Record<ProcessInfo["terminal"], string> = {
  agent: "Agent",
  shell: "Shell",
};

export function ProcessesSection({ root }: { root: RepoRoot }) {
  const { data, isLoading, error, refetch } = useTaskProcesses(root);

  if (root.kind !== "task") return <ExplorerNote>Processes belong to a task.</ExplorerNote>;
  if (isLoading) return <ExplorerLoading>Reading processes…</ExplorerLoading>;
  // A poll that failed once with a tree in hand keeps the tree: the next one
  // two seconds later is likelier to answer than the user is to click Retry.
  if (error && !data) {
    return (
      <ExplorerError onRetry={() => refetch()}>
        {error instanceof Error ? error.message : String(error)}
      </ExplorerError>
    );
  }
  if (!data) return null;
  // `live: false` is every terminal gone, which is a suspended task but also
  // an open one whose agent has exited with no shell tab beside it: the copy
  // has to be true of both.
  if (!data.live) {
    return <ExplorerNote>Nothing is running: the task has no live terminal.</ExplorerNote>;
  }
  if (data.processes.length === 0) return <ExplorerNote>No processes.</ExplorerNote>;

  return (
    <div className="h-full min-h-0 overflow-y-auto py-1">
      {!data.portsKnown ? (
        <ExplorerNote>Listening ports could not be read on this machine.</ExplorerNote>
      ) : null}
      {data.processes.map((process) => (
        <div key={`${process.terminal}-${process.pid}`}>
          {process.depth === 0 ? <SectionLabel>{TERMINAL_LABEL[process.terminal]}</SectionLabel> : null}
          <ProcessRow process={process} />
        </div>
      ))}
    </div>
  );
}

function ProcessRow({ process }: { process: ProcessInfo }) {
  return (
    <div
      data-pid={process.pid}
      title={process.command}
      // The same 12px-per-level indent as the file trees, off the same gutter.
      style={{ paddingLeft: 8 + process.depth * 12 }}
      className="flex h-row min-w-0 items-center gap-2 pr-2 text-foreground hover:bg-hover"
    >
      <span className="w-12 flex-none font-mono text-micro tracking-mono text-subtle-foreground">
        {process.pid}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-mono">
        {shortCommand(process.command)}
      </span>
      {process.ports.map((port) => (
        <a
          key={port}
          // The daemon and the browser are the same machine whenever ports
          // mean anything to the user, which is the loopback case.
          href={`http://localhost:${port}`}
          target="_blank"
          rel="noreferrer"
          title={`Open localhost:${port}`}
          className="group flex-none"
        >
          <Badge className="group-hover:bg-selected group-hover:text-selected-foreground">:{port}</Badge>
        </a>
      ))}
    </div>
  );
}
