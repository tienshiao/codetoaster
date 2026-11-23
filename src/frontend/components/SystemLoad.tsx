import { SystemLoadIndicator } from "@/frontend/components/v2/SystemLoad";
import { useSystemLoad } from "@/frontend/system-load-store";

/**
 * The rail's load meter, fed from the socket (TASK-149).
 *
 * Its own component so the store is read here and nowhere above: a sample
 * every two seconds re-renders this, not `TaskShell` and the shell under it.
 */
export function SystemLoad() {
  const { samples, intervalMs, capacity } = useSystemLoad();
  return <SystemLoadIndicator samples={samples} intervalMs={intervalMs} capacity={capacity} />;
}
