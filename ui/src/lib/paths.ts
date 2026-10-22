import type { CategoryId, Settings } from '../../../shared/protocol';

const FOLDER: Record<CategoryId, string> = { general: '', compressed: 'Compressed', documents: 'Documents', music: 'Music', programs: 'Programs', video: 'Video' };

/** Where a file of `category` goes with these settings (mirrors the engine's dirFor). */
export function categoryDir(settings: Settings, category: CategoryId): string {
  const sep = settings.downloadDir.includes('\\') ? '\\' : '/';
  const sub = settings.useCategoryFolders ? FOLDER[category] : '';
  return sub ? `${settings.downloadDir.replace(/[\\/]+$/, '')}${sep}${sub}` : settings.downloadDir;
}

const CAT_EXT: [CategoryId, string[]][] = [
  ['compressed', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab']],
  ['documents', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'txt', 'rtf', 'csv', 'epub', 'md']],
  ['music', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus']],
  ['programs', ['exe', 'msi', 'msix', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appimage']],
  ['video', ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v', '3gp', 'mpg', 'mpeg']],
];

export function guessCategory(fileName: string): CategoryId {
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  for (const [id, exts] of CAT_EXT) if (exts.includes(ext)) return id;
  return 'general';
}

export function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : '';
  } catch {
    return '';
  }
}
