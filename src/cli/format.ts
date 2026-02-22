export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i]!)).join("  ");

  const out: string[] = [];
  out.push(line(headers));
  out.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    out.push(line(row));
  }
  return out.join("\n");
}

export function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

export function formatSessionId(id: string): string {
  // Session IDs are like "name-uuid". Show first 8 chars of UUID portion.
  const parts = id.split("-");
  if (parts.length <= 1) return id;
  // UUID is the last 5 segments joined by dashes
  const uuidStart = parts.slice(-5).join("-").substring(0, 8);
  return uuidStart;
}
