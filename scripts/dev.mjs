// Dev runner: build main/preload once, start the Vite dev server, launch Electron.
// Dry-run is the default; live mode only if OPTIMIZER_LIVE=1 is already in your environment.
// Exit code 3 = the app relaunched itself elevated, so keep the dev server up for it.
import { build, createServer } from 'vite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);

await build({ configFile: 'vite.electron.config.mts', logLevel: 'warn' });
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`renderer: ${url}  mode: ${process.env.OPTIMIZER_LIVE === '1' ? 'LIVE' : 'dry-run'}`);

const child = spawn(electron, [root], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  if (code === 3) return console.log('relaunched as admin; dev server stays up (Ctrl+C to stop)');
  await server.close();
  process.exit(code ?? 0);
});
