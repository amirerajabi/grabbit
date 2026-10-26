// The site grabber (IDM's "Grabber"): starting from one page, follow links up to a depth and collect links to files of
// chosen types. Pages are fetched through the same request code as downloads (proxy, saved logins); only HTML is parsed.
import type { GrabRequest, GrabResult } from '../../../shared/protocol';
import { openRequest } from './http';

const MAX_HTML = 4 * 1024 * 1024;
const PAGE_EXT = new Set(['', 'html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'shtml', 'cgi', 'xhtml']);
const CONCURRENCY = 4;

export const GRAB_MAX_PAGES = 300;

function extOf(u: URL): string {
  const last = u.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
}

const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** True for the start page's host and its subdomains ("www." is ignored on both sides). */
function sameSite(start: string, host: string): boolean {
  const a = siteOf(start);
  const b = siteOf(host);
  return a === b || b.endsWith(`.${a}`);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

/** Absolute http(s)/ftp links in an HTML page: href, src and data-src attributes, resolved against <base> or the page. */
export function linksIn(html: string, pageUrl: string): URL[] {
  const baseHref = /<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(html)?.[1];
  let base = pageUrl;
  try {
    if (baseHref) base = new URL(decodeEntities(baseHref), pageUrl).href;
  } catch {
    /* a broken <base> is ignored */
  }
  const out = new Map<string, URL>();
  for (const m of html.replace(/<base\s[^>]*>/gi, '').matchAll(/\b(?:href|src|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)) {
    const raw = decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!raw || /^(javascript|mailto|data|tel|#)/i.test(raw)) continue;
    try {
      const u = new URL(raw, base);
      if (!/^(https?|s?ftp):$/.test(u.protocol)) continue;
      u.hash = '';
      out.set(u.href, u);
    } catch {
      /* not a URL */
    }
  }
  return [...out.values()];
}

async function fetchHtml(url: string, headers: Record<string, string>, timeoutMs: number, signal: AbortSignal): Promise<{ html: string; finalUrl: string } | null> {
  const { res, finalUrl } = await openRequest(url, { headers, timeoutMs, signal });
  try {
    if (!/html/i.test(res.headers['content-type'] ?? '')) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of res as AsyncIterable<Buffer>) {
      chunks.push(c);
      size += c.length;
      if (size > MAX_HTML) break;
    }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl };
  } finally {
    res.destroy();
  }
}

/**
 * Crawls breadth-first: depth 0 reads only the start page, 1 also the pages it links to, and so on. Stops at
 * GRAB_MAX_PAGES pages (the result says so). A page that fails to load is skipped, except the start page.
 */
export async function grabSite(
  req: GrabRequest,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
  onProgress: (pages: number, files: number) => void,
): Promise<GrabResult> {
  const start = new URL(req.url);
  const exts = new Set(req.extensions.map((e) => e.trim().replace(/^\./, '').toLowerCase()).filter(Boolean));
  const files = new Map<string, string>(); // file URL → page it was found on
  const seen = new Set<string>([start.href]);
  let level: string[] = [start.href];
  let pages = 0;
  let truncated = false;

  for (let depth = 0; depth <= req.depth && level.length && !signal.aborted; depth++) {
    const next: string[] = [];
    let i = 0;
    const worker = async () => {
      while (i < level.length && !signal.aborted) {
        if (pages >= GRAB_MAX_PAGES) {
          truncated = true;
          return;
        }
        const url = level[i++];
        pages++;
        let page: Awaited<ReturnType<typeof fetchHtml>>;
        try {
          page = await fetchHtml(url, headers, timeoutMs, signal);
        } catch (e) {
          if (url === start.href) throw e;
          continue;
        }
        if (!page) continue;
        for (const link of linksIn(page.html, page.finalUrl)) {
          const ext = extOf(link);
          // "Stay on this site" limits the pages followed; files are often on another host (a CDN) and are kept.
          if (exts.has(ext)) {
            if (!files.has(link.href)) files.set(link.href, url);
          } else if (depth < req.depth && PAGE_EXT.has(ext) && /^https?:$/.test(link.protocol) && !seen.has(link.href)) {
            if (req.sameSite && !sameSite(start.hostname, link.hostname)) continue;
            seen.add(link.href);
            next.push(link.href);
          }
        }
        onProgress(pages, files.size);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    level = next;
  }
  return { files: [...files.keys()], pages, truncated, stopped: signal.aborted };
}
