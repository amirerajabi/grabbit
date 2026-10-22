// Bundle main and preload with esbuild (CommonJS, Electron's Node). Electron itself stays external.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'], sourcemap: true, logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'out/main.js' }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'out/preload.js' }),
]);
