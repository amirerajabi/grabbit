// File names Grabbit extracts after download: ZIP, 7z and RAR, including multi-part sets (mirrors
// engine/src/core/extract.ts, which decides for real).
const ARCHIVE = /\.(zip|7z|rar|r\d{2}|z\d{2}|(7z|zip|rar)\.\d{3})$/i;

export function isArchive(fileName: string): boolean {
  return ARCHIVE.test(fileName);
}
