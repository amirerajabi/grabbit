import type { HashAlgo } from '../../../shared/protocol';

const LENGTHS: Record<HashAlgo, number> = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };

export const ALGO_LABEL: Record<HashAlgo, string> = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' };

/** Same rules as the engine's parseChecksum: hex whose length names the algorithm, optionally "sha256:" first. */
export function isChecksum(text: string): boolean {
  let t = text.trim();
  let algo: HashAlgo | null = null;
  const m = /^(md5|sha-?1|sha-?256|sha-?512)\s*[:=]\s*(.+)$/i.exec(t);
  if (m) {
    algo = m[1].toLowerCase().replace('-', '') as HashAlgo;
    t = m[2].trim();
  }
  const hex = /^([0-9a-fA-F]+)(\s|$)/.exec(t)?.[1];
  if (!hex) return false;
  return algo ? LENGTHS[algo] === hex.length : Object.values(LENGTHS).includes(hex.length);
}
