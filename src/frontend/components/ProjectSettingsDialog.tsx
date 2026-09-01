import type { ProjectInfo, ProjectSettings } from "../../lib/xtmux/types";
import { ProjectDialog, type ProjectFormValues } from "@/frontend/components/ProjectDialog";

export interface ProjectSettingsDialogProps {
  project: ProjectInfo;
  open: boolean;
  onClose: () => void;
  /** One call for the whole dialog. `updateProject` takes the name, the path
   * and the settings together, so saving them as one message is what keeps a
   * half-applied edit from leaving the row disagreeing with itself. */
  onSave: (name: string, initialPath: string, settings: Partial<ProjectSettings>) => void;
}

/** A project's columns as the form carries them: strings, because a text input
 * has no way to say `null` and blank already means unset everywhere below. */
function valuesOf(project: ProjectInfo): ProjectFormValues {
  return {
    name: project.name,
    path: project.initialPath ?? "",
    defaultModel: project.defaultModel ?? "",
    defaultBaseRef: project.defaultBaseRef ?? "",
    worktreeDefault: project.worktreeDefault,
    setupCommand: project.setupCommand ?? "",
    worktreeCopy: project.worktreeCopy ?? "",
  };
}

/**
 * Editing a project: `ProjectDialog` seeded from one that exists.
 *
 * The form itself lives there and is shared with creating a project, which
 * used to ask for two of these eight fields (TASK-81). What is left here is
 * the half that differs - where the values come from, what the title says, and
 * where Save sends them.
 */
export function ProjectSettingsDialog({
  project,
  open,
  onClose,
  onSave,
}: ProjectSettingsDialogProps) {
  return (
    <ProjectDialog
      open={open}
      title={`${project.name} settings`}
      description="What this project is, and what its tasks default to. The composer can override each default."
      confirmLabel="Save"
      initial={valuesOf(project)}
      // Keyed by project, so a dialog reopened on a different row re-reads
      // rather than showing the last one's values.
      seedKey={project.id}
      onSubmit={onSave}
      onClose={onClose}
    />
  );
}
