import { Button, Input } from "codetoaster";
import { FolderOpen } from "lucide-react";

const Field = ({
  label,
  hint,
  htmlFor,
  children,
  tone = "muted",
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  tone?: "muted" | "destructive";
}) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
      {label}
    </label>
    {children}
    {hint ? (
      <p className={tone === "destructive" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hint}</p>
    ) : null}
  </div>
);

// The New / Edit Project form: name plus an initial path with a browse button.
export const ProjectForm = () => (
  <div className="flex w-[420px] flex-col gap-4">
    <Field label="Name" htmlFor="project-name">
      <Input id="project-name" defaultValue="codetoaster" placeholder="Project name" />
    </Field>
    <Field
      label="Initial Path"
      htmlFor="project-path"
      hint="New sessions in this project will start in this directory"
    >
      <div className="flex gap-2">
        <Input
          id="project-path"
          className="flex-1"
          defaultValue="~/Projects/codetoaster"
          placeholder="~/projects/my-app"
        />
        <Button type="button" variant="outline" size="icon" title="Browse directories">
          <FolderOpen size={16} />
        </Button>
      </div>
    </Field>
  </div>
);

export const States = () => (
  <div className="flex w-[420px] flex-col gap-4">
    <Field label="Empty" htmlFor="in-empty">
      <Input id="in-empty" placeholder="codetoaster · v2" />
    </Field>
    <Field label="Filled" htmlFor="in-filled">
      <Input id="in-filled" defaultValue="api-gateway · main" />
    </Field>
    <Field label="Disabled" htmlFor="in-disabled" hint="Suspended sessions cannot be renamed">
      <Input id="in-disabled" disabled defaultValue="docs-site · draft" />
    </Field>
    <Field
      label="Invalid"
      htmlFor="in-invalid"
      hint="A session with that name already exists"
      tone="destructive"
    >
      <Input id="in-invalid" aria-invalid defaultValue="codetoaster · v2" />
    </Field>
  </div>
);

export const InputTypes = () => (
  <div className="flex w-[420px] flex-col gap-4">
    <Field label="Search sessions" htmlFor="in-search">
      <Input id="in-search" type="search" defaultValue="xtmux" />
    </Field>
    <Field label="Daemon port" htmlFor="in-port" hint="Port the CodeToaster server listens on">
      <Input id="in-port" type="number" defaultValue={4269} />
    </Field>
    <Field label="Import terminal theme" htmlFor="in-file" hint="A JSON theme exported from xterm-theme">
      <Input id="in-file" type="file" />
    </Field>
  </div>
);
