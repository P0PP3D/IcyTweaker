// Downloads for the approved tools (NVIDIA drivers, PresentMon). Files go only under the app data folder, and
// every executable must carry a valid Authenticode signature from the expected publisher before it is run.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

/** Only these hosts are ever downloaded from. */
const ALLOWED_HOSTS = [/^([a-z0-9-]+\.)*download\.nvidia\.com$/i, /^github\.com$/i, /^objects\.githubusercontent\.com$/i, /^release-assets\.githubusercontent\.com$/i];
export const allowedUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
};

export async function download(url: string, dest: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  if (!allowedUrl(url)) throw new Error(`Refusing to download from ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  if (!allowedUrl(res.url)) throw new Error(`Download was redirected to an unexpected host: ${new URL(res.url).hostname}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (c: Buffer) => {
    done += c.length;
    if (onProgress && Date.now() - last > 250) {
      last = Date.now();
      onProgress(done, total);
    }
  });
  const part = `${dest}.part`;
  try {
    await pipeline(body, createWriteStream(part));
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  onProgress?.(done, total);
}

/** Throws unless the file's Authenticode signature is valid and the signer's subject contains `publisher`. */
export async function verifySignature(adapter: Pick<SystemAdapter, 'query'>, file: string, publisher: string): Promise<void> {
  const f = file.replace(/'/g, "''");
  const out = await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${f}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], 60_000);
  const [status, subject = ''] = out.trim().split('|');
  if (status !== 'Valid' || !subject.includes(`O=${publisher}`)) {
    throw new Error(`${path.basename(file)} is not validly signed by ${publisher} (${status || 'no signature'}). It was not run.`);
  }
}
