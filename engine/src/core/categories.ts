import type { CategoryId, CategoryInfo } from '../../../shared/protocol';

/** IDM's default categories: each one picks a sub-folder of the download directory by file extension. */
export const CATEGORIES: CategoryInfo[] = [
  { id: 'general', label: 'General', extensions: [] },
  { id: 'compressed', label: 'Compressed', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab', 'arj', 'lzh'] },
  { id: 'documents', label: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'rtf', 'csv', 'epub', 'mobi', 'md'] },
  { id: 'music', label: 'Music', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'wma', 'opus', 'aif', 'aiff', 'mid'] },
  { id: 'programs', label: 'Programs', extensions: ['exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appimage', 'jar', 'bat', 'sh'] },
  { id: 'video', label: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v', '3gp', 'mpg', 'mpeg', 'ts', 'vob'] },
];

const FOLDER: Record<CategoryId, string> = {
  general: '',
  compressed: 'Compressed',
  documents: 'Documents',
  music: 'Music',
  programs: 'Programs',
  video: 'Video',
};

export function categoryFolder(id: CategoryId): string {
  return FOLDER[id];
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function categoryFor(fileName: string, mime?: string | null): CategoryId {
  const ext = extensionOf(fileName);
  if (ext) {
    for (const c of CATEGORIES) if (c.extensions.includes(ext)) return c.id;
  }
  if (mime) {
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'music';
    if (/zip|rar|7z|tar|gzip|compressed/.test(mime)) return 'compressed';
    if (/pdf|msword|officedocument|text\//.test(mime)) return 'documents';
    if (/x-msdownload|x-msi|octet-stream.*exe/.test(mime)) return 'programs';
  }
  return 'general';
}

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === 'string' && CATEGORIES.some((c) => c.id === v);
}
