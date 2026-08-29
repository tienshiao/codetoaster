import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, InitialPathAutocomplete } from "codetoaster";
import { FolderOpen } from "lucide-react";

const noop = () => {};

// The component reads its suggestions through useDirectories -> useQuery, so a
// preview needs a QueryClient. Seeding the exact ["directories", <path>] key
// renders the real dropdown instead of stubbing one: the component's own
// debouncedValue starts at `value`, so a cache hit is available on first paint.
function withDirectories(path: string, parent: string, directories: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (path) client.setQueryData(["directories", path], { parent, directories });
  return client;
}

const Shell = ({ client, children }: { client: QueryClient; children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const Field = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div className="flex w-[420px] flex-col gap-1.5">
    <label htmlFor="project-path" className="text-sm font-medium text-foreground">
      Initial Path
    </label>
    {children}
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
  </div>
);

export const EmptyField = () => (
  <Shell client={withDirectories("", "", [])}>
    <Field hint="New sessions in this project will start in this directory">
      <InitialPathAutocomplete
        inputId="project-path"
        value=""
        onChange={noop}
        placeholder="~/projects/my-app"
      />
    </Field>
  </Shell>
);

// As it sits inside the Project dialog: the field plus the browse-directories button.
export const InProjectDialog = () => (
  <Shell client={withDirectories("/Users/tma/Projects/codetoaster/", "/Users/tma/Projects/codetoaster", [])}>
    <Field hint="New sessions in this project will start in this directory">
      <div className="flex gap-2">
        <div className="flex-1">
          <InitialPathAutocomplete
            inputId="project-path"
            value="/Users/tma/Projects/codetoaster/"
            onChange={noop}
            placeholder="~/projects/my-app"
          />
        </div>
        <Button type="button" variant="outline" size="icon" title="Browse directories">
          <FolderOpen size={16} />
        </Button>
      </div>
    </Field>
  </Shell>
);

// Typing a partial path opens the suggestion list; the first entry is selected.
export const Suggestions = () => (
  <div style={{ height: 300 }}>
    <Shell
      client={withDirectories("/Users/tma/Projects/", "/Users/tma/Projects", [
        "codetoaster",
        "api-gateway",
        "docs-site",
        "xtmux-protocol",
      ])}
    >
      <Field>
        <InitialPathAutocomplete
          inputId="project-path"
          value="/Users/tma/Projects/"
          onChange={noop}
          placeholder="~/projects/my-app"
        />
      </Field>
    </Shell>
  </div>
);
