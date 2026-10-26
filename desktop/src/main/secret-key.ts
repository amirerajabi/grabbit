// The key the engine encrypts saved logins with. It is random per installation and kept in the OS's protected storage
// through Electron's safeStorage (DPAPI on Windows, the Keychain on macOS, the secret service on Linux), so the logins
// file is unreadable without this user's OS account. Where safeStorage isn't available (some Linux setups) the key file
// is plain but readable by this user only.
import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function secretKey(): string {
  const dir = app.getPath('userData');
  const sealed = path.join(dir, 'secret-key.bin');
  const plain = path.join(dir, 'secret-key.txt');
  const canSeal = safeStorage.isEncryptionAvailable();
  try {
    if (canSeal && fs.existsSync(sealed)) return safeStorage.decryptString(fs.readFileSync(sealed));
    if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8').trim();
  } catch {
    // An unreadable key (profile copied from another machine): start with a new one; old logins can't be decrypted.
  }
  const key = randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  if (canSeal) fs.writeFileSync(sealed, safeStorage.encryptString(key));
  else fs.writeFileSync(plain, key, { mode: 0o600 });
  return key;
}
