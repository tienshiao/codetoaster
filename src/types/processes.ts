/** One process under a task's terminals (TASK-138.1). */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** The full command line, as `ps` prints it. */
  command: string;
  /** How far below the terminal it hangs: the terminal's own program is 0. */
  depth: number;
  /** Which of the task's terminals this tree hangs from: "agent" for the
   * agent's, "shell" for a shell tab's. Set on every row, not only the root,
   * so a client can group without walking parents. */
  terminal: "agent" | "shell";
  /** TCP ports it is listening on, ascending. Empty when it holds none, or
   * when ports could not be read at all (`portsKnown` says which). */
  ports: number[];
}

export interface ProcessesResponse {
  /** Whether the task has any running terminal. A suspended or evicted task
   * has none, and so no processes — which is a state, not an empty tree. */
  live: boolean;
  /** Depth-first, each terminal's tree in turn, children by pid. */
  processes: ProcessInfo[];
  /** False when the port lookup failed or is unavailable (no `lsof`), so an
   * empty `ports` is not read as "listening on nothing". */
  portsKnown: boolean;
}
