// Clipboard monitoring (IDM's "catch links from the clipboard"): poll the text clipboard and report new http(s) links
// that point at one of the capture extensions.
import { clipboard } from 'electron';

const INTERVAL_MS = 800;

export function isDownloadLink(text: string, extensions: string[]): boolean {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t) || t.length > 4096) return false;
  try {
    const u = new URL(t);
    const last = u.pathname.split('/').pop() ?? '';
    const ext = last.includes('.') ? last.split('.').pop()!.toLowerCase() : '';
    return ext !== '' && extensions.includes(ext);
  } catch {
    return false;
  }
}

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null;
  private last = '';
  private extensions: string[] = [];

  constructor(private readonly onLink: (url: string) => void) {}

  configure(enabled: boolean, extensions: string[]): void {
    this.extensions = extensions.map((e) => e.toLowerCase());
    if (enabled && !this.timer) {
      // Whatever is on the clipboard already does not count, only what gets copied from now on.
      this.last = clipboard.readText();
      this.timer = setInterval(() => this.poll(), INTERVAL_MS);
    } else if (!enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** The app itself copied this (Copy address): do not offer it back. */
  ignore(text: string): void {
    this.last = text;
  }

  private poll(): void {
    const text = clipboard.readText();
    if (text === this.last) return;
    this.last = text;
    if (isDownloadLink(text, this.extensions)) this.onLink(text.trim());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
