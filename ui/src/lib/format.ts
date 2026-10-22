const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${UNITS[i]}`;
}

export function formatSpeed(bps: number): string {
  if (!bps || bps < 1) return '—';
  return `${formatBytes(bps)}/s`;
}

export function formatEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  if (sec < 1) return '< 1 s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 99) return '> 99 h';
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export function percent(received: number, size: number | null): number | null {
  if (!size) return null;
  return Math.min(100, (received / size) * 100);
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

/** Parse "512 KB", "2 MB", "1.5mb", "800" (KB) into bytes/s; null when invalid. */
export function parseRate(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?\s*(\/s)?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = (m[2] ?? 'kb').toLowerCase();
  const mult = unit === 'b' ? 1 : unit.startsWith('k') ? 1024 : unit.startsWith('m') ? 1024 ** 2 : 1024 ** 3;
  return Math.round(v * mult);
}
