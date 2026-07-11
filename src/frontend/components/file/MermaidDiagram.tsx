import { useEffect, useState } from "react";

// Mermaid is >1MB, so load it on demand the first time a diagram renders,
// and share the single instance across all diagrams.
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
function loadMermaid() {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

let nextDiagramId = 0;

interface MermaidDiagramProps {
  source: string;
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    loadMermaid()
      .then((mermaid) => {
        // Theme is picked per render so newly drawn diagrams follow the
        // current app theme. initialize() rebuilds the whole site config
        // from defaults each call, so every option must be passed each time.
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: isDark ? "dark" : "default",
        });
        return mermaid.render(`mermaid-diagram-${nextDiagramId++}`, source);
      })
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="my-3 border border-destructive/50 rounded-md overflow-hidden">
        <div className="px-3 py-1.5 text-xs text-destructive bg-destructive/10">
          Mermaid: {error}
        </div>
        <pre className="px-3 py-2 text-xs overflow-x-auto">{source}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 py-4 text-xs text-muted-foreground italic">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram my-3 flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
