/** IPC channel names shared by main and preload. */
export const CH = {
  chooseFolder: 'grabbit:choose-folder',
  notify: 'grabbit:notify',
  setProgress: 'grabbit:set-progress',
  setTheme: 'grabbit:set-theme',
  setPreferences: 'grabbit:set-preferences',
  readClipboard: 'grabbit:read-clipboard',
  clipboardUrl: 'grabbit:clipboard-url',
  command: 'grabbit:command',
} as const;

/** additionalArguments passed to the renderer: --grabbit-engine=<url> --grabbit-token=<token> --grabbit-titlebar=<kind> */
export const ARG = {
  engine: '--grabbit-engine=',
  token: '--grabbit-token=',
  titleBar: '--grabbit-titlebar=',
} as const;

export interface Preferences {
  clipboardMonitor: boolean;
  captureExtensions: string[];
  minimizeToTray: boolean;
}
