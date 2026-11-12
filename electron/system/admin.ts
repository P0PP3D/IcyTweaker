// Admin detection and one-click UAC relaunch. Neither changes system state.
import path from 'node:path';
import { POWERSHELL_EXE, run } from './adapter';

/** `net session` only succeeds in an elevated process. */
export const isAdmin = () =>
  run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'net.exe'), ['session'], 5_000).then(
    () => true,
    () => false,
  );

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Start this app again elevated. An elevated child does not inherit our environment, so the
 * elevated PowerShell sets OPTIMIZER_LIVE / VITE_DEV_SERVER_URL to the values this process has
 * (it keeps the current mode, never turns live on) before it starts the app.
 * Throws if the UAC prompt is cancelled.
 */
export async function relaunchAsAdmin(live: boolean, devUrl: string | undefined) {
  const args = process.argv.slice(1).map((a) => psQuote(`"${a}"`));
  const inner = [
    live && `$env:OPTIMIZER_LIVE='1'`,
    devUrl && `$env:VITE_DEV_SERVER_URL=${psQuote(devUrl)}`,
    `Start-Process -FilePath ${psQuote(process.execPath)} -WorkingDirectory ${psQuote(process.cwd())}` +
      (args.length ? ` -ArgumentList ${args.join(',')}` : ''),
  ]
    .filter(Boolean)
    .join('; ');
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  await run(
    POWERSHELL_EXE,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process -FilePath ${psQuote(POWERSHELL_EXE)} -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
    ],
    60_000,
  );
}
