const UNITS = ["B", "KB", "MB", "GB"];

/** A byte count for a chip or a file row: three significant figures at most,
 * and no decimal on bytes, where a fraction of one does not exist. */
export function formatSize(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}
