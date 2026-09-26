import { useSyncExternalStore } from "react";
import { useTasks } from "@/frontend/TaskContext";
import { getComposerDraft, subscribeComposerDraft } from "@/frontend/composer-draft-store";
import type { ProjectInfo } from "@/lib/xtmux/types";

/** The draft's selected project id, and nothing else of the draft. */
const selectProjectId = (): string => getComposerDraft().projectId;

/**
 * The project the composer is drafting for: the draft's selection, or the
 * first project when it names nothing yet or names one that is gone.
 *
 * One derivation for both readers. The composer shows it on its chip, and the
 * shell hands it to the Explorer (TASK-106) so the right-hand panel browses the
 * same repository the prompt is about to be sent to — two copies of the
 * fallback would disagree in exactly the frame the project list lands.
 *
 * Subscribed through a selector rather than to the draft itself: the draft is
 * replaced on every keystroke in the prompt, and the shell — which mounts this
 * — would re-render the sidebar, the Explorer and the strip per character. A
 * string snapshot only changes when the project does.
 *
 * Undefined only while there are no projects at all: the list arrives over the
 * socket, so the first render has none.
 */
export function useComposerProject(): ProjectInfo | undefined {
  const projectId = useSyncExternalStore(subscribeComposerDraft, selectProjectId, selectProjectId);
  const { projects } = useTasks();
  return projects.find((p) => p.id === projectId) ?? projects[0];
}
