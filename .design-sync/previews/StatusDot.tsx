import { StatusDot } from "codetoaster";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2.5 text-sm text-foreground">
    {children}
    <span>{label}</span>
  </div>
);

export const States = () => (
  <div className="flex flex-col gap-3">
    <Row label="Connected">
      <StatusDot isConnected isExited={false} isActive={false} />
    </Row>
    <Row label="Active — output streaming">
      <StatusDot isConnected isExited={false} isActive />
    </Row>
    <Row label="Exited">
      <StatusDot isConnected={false} isExited isActive={false} />
    </Row>
    {/* `isResuming` is deliberately absent: it only adds `animate-pulse` to the
        suspended ring, so a still frame of it is pixel-identical to the row
        above and would read as a duplicate rather than a fifth state. */}
    <Row label="Suspended — dormant, one click from running">
      <StatusDot isConnected={false} isExited={false} isActive={false} isSuspended />
    </Row>
  </div>
);

/* `hasNotification` layers an amber ping over whichever colour the state already
   earned, so it is shown against its own baseline. It is not shown on a
   suspended row: a suspended task returns the hollow ring before the
   notification branch is reached, so the flag would render nothing. */
export const WithNotification = () => (
  <div className="flex flex-col gap-3">
    <Row label="Connected — output already read">
      <StatusDot isConnected isExited={false} isActive={false} />
    </Row>
    <Row label="Connected — unread output">
      <StatusDot isConnected isExited={false} isActive={false} hasNotification />
    </Row>
    <Row label="Exited — unread output">
      <StatusDot isConnected={false} isExited isActive={false} hasNotification />
    </Row>
  </div>
);

export const InSessionList = () => (
  <div className="flex w-72 flex-col gap-1 rounded-md border border-border p-2">
    {[
      { name: "codetoaster · v2", connected: true, active: true },
      { name: "api-gateway · main", connected: true, active: false },
      { name: "docs-site · draft", connected: false, active: false },
    ].map((s) => (
      <div key={s.name} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-accent">
        <StatusDot isConnected={s.connected} isExited={false} isActive={s.active} isSuspended={!s.connected} />
        <span className="truncate text-foreground">{s.name}</span>
      </div>
    ))}
  </div>
);
