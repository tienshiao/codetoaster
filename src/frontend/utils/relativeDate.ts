// Format a unix timestamp (seconds) as a short relative string, e.g.
// "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "1y ago".
export function relativeDate(unixSeconds: number, now: number = Date.now()): string {
  const diffMs = now - unixSeconds * 1000;
  const sec = Math.floor(diffMs / 1000);
  // Each bucket's cutoff equals the next bucket's divisor, so a "0<unit> ago"
  // string can never be produced (e.g. 45–59s stays "just now", 360–364d stays
  // in the months bucket rather than rounding down to "0y ago").
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (day < 365) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

// Absolute local date+time for tooltips / headers.
export function absoluteDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}
