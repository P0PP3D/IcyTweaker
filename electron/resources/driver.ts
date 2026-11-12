// Automated GPU driver reinstall (NVIDIA): a resumable job across one restart.
//   begin:   download the latest official driver (NVIDIA's own lookup service), check its NVIDIA signature,
//            install DDU through winget if needed, add an elevated sign-in task, run DDU (cleans the driver, restarts)
//   resume:  after the restart, the app starts again (the sign-in task, removed once the driver is in); the user presses Continue and the new
//            driver installs silently as a clean install
// The job state lives in driver-job.json in the app data folder, so it survives the restart.
// AMD: the installed version is shown, but AMD has no public version service, so there is no automatic reinstall.
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DriverInfo, DriverJobView, HardwareInfo } from '../../shared/types';
import type { SystemAdapter } from '../system/adapter';
import { DRIVER_TASK, setLogonTask } from '../system/tasks';
import { allowedUrl, download, verifySignature } from '../system/download';

const PRODUCTS_URL = 'https://www.nvidia.com/Download/API/lookupValueSearch.aspx?TypeID=3';
const lookupUrl = (psid: string, pfid: string) =>
  `https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&psid=${psid}&pfid=${pfid}&osID=57&languageCode=1033&isWHQL=1&dch=1&sort1=0&numberOfResults=1`;

// verify: DDU command-line switches (from its documentation; not run on the dev PC). DDU restarts the PC itself.
export const DDU_ARGS = ['-silent', '-cleannvidia', '-restart'];
// verify: NVIDIA package switches: -s silent, -noreboot, -clean (clean install, resets driver settings).
export const NVIDIA_INSTALL_ARGS = ['-s', '-noreboot', '-clean'];

const stripNvidia = (s: string) => s.replace(/^NVIDIA\s+/i, '').trim().toLowerCase();

/** NVIDIA's product list -> the series (psid) and product (pfid) ids for this exact GPU name, or null. */
export function findNvidiaProduct(xml: string, gpuName: string): { psid: string; pfid: string } | null {
  const want = stripNvidia(gpuName);
  for (const m of xml.matchAll(/<LookupValue ParentID="(\d+)"[^>]*>\s*<Name>([^<]*)<\/Name>\s*<Value>(\d+)<\/Value>/g)) {
    if (stripNvidia(m[2]) === want) return { psid: m[1], pfid: m[3] };
  }
  return null;
}

/** NVIDIA's driver lookup answer -> the latest WHQL Game Ready / Studio driver, refusing anything unexpected. */
export function parseNvidiaLookup(json: string): NonNullable<DriverInfo['latest']> {
  const d = JSON.parse(json)?.IDS?.[0]?.downloadInfo;
  if (!d?.Version || !d?.DownloadURL) throw new Error('NVIDIA returned no driver for this GPU.');
  const name = decodeURIComponent(String(d.Name ?? ''));
  if (!allowedUrl(d.DownloadURL) || /tesla|data center/i.test(`${name} ${d.DownloadURL}`)) throw new Error(`Unexpected driver from NVIDIA: ${name}`);
  return { version: String(d.Version), url: String(d.DownloadURL), name, released: String(d.ReleaseDateTime ?? ''), size: String(d.DownloadURLFileSize ?? '') };
}

/** Windows driver version 32.0.16.2114 -> NVIDIA's 621.14 (last five digits). */
export const nvidiaVersion = (windows: string) => {
  const digits = windows.split('.').slice(-2).join('');
  return digits.length >= 5 ? `${digits.slice(-5, -2)}.${digits.slice(-2)}` : null;
};

type FetchText = (url: string) => Promise<string>;
const fetchText: FetchText = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

export async function driverInfo(hw: HardwareInfo | null, get: FetchText = fetchText): Promise<DriverInfo> {
  const gpu = hw?.gpus.find((g) => g.vendor === 'NVIDIA') ?? hw?.gpus.find((g) => g.vendor === 'AMD') ?? hw?.gpus[0];
  if (!gpu) return { vendor: null, gpu: null, installed: null, latest: null, error: 'No graphics card found.' };
  if (gpu.vendor !== 'NVIDIA') {
    return {
      vendor: gpu.vendor,
      gpu: gpu.name,
      installed: gpu.driver,
      latest: null,
      error: gpu.vendor === 'AMD' ? 'Automatic reinstall supports NVIDIA only: AMD has no public driver version service. Use AMD Software or amd.com.' : 'Automatic reinstall supports NVIDIA graphics cards.',
    };
  }
  const info: DriverInfo = { vendor: 'NVIDIA', gpu: gpu.name, installed: nvidiaVersion(gpu.driver), latest: null };
  try {
    const product = findNvidiaProduct(await get(PRODUCTS_URL), gpu.name);
    if (!product) return { ...info, error: `NVIDIA's driver list has no exact match for "${gpu.name}".` };
    info.latest = parseNvidiaLookup(await get(lookupUrl(product.psid, product.pfid)));
  } catch (err) {
    info.error = `Could not check the latest driver: ${(err as Error).message}`;
  }
  return info;
}

export function createDriverJob(o: {
  adapter: SystemAdapter;
  dataDir: string;
  /** Command line that starts this app with --resume-driver-job. */
  resumeCommand: string;
  winget: string;
  dduExe: string;
  log: (action: string, target: string, ok: boolean, message?: string) => Promise<void>;
  progress: (done: number, total: number, current: string) => void;
  /** Exports the installed drivers first (pnputil), so the old driver can be put back. */
  backup?: () => Promise<unknown>;
}) {
  const file = path.join(o.dataDir, 'driver-job.json');
  const read = async (): Promise<DriverJobView | null> => readFile(file, 'utf8').then((s) => JSON.parse(s) as DriverJobView, () => null);
  const save = (j: DriverJobView) => writeFile(file, JSON.stringify(j, null, 2));
  const dry = o.adapter.live ? '' : ' (dry-run: nothing downloaded or run)';

  return {
    status: read,

    /** Download, verify, install DDU, set RunOnce, run DDU (which restarts the PC). Caller checks admin and makes a restore point. */
    async begin(latest: NonNullable<DriverInfo['latest']>, gpu: string): Promise<DriverJobView> {
      const installer = path.join(o.dataDir, 'downloads', path.basename(new URL(latest.url).pathname));
      const job: DriverJobView = { step: 'downloading', gpu, version: latest.version, installer, startedAt: new Date().toISOString(), message: 'Downloading the driver…' };
      await save(job);
      try {
        if (o.adapter.live) {
          if (!existsSync(installer)) await download(latest.url, installer, (d, t) => o.progress(d, t, `Driver ${latest.version}`));
          await verifySignature(o.adapter, installer, 'NVIDIA Corporation');
          if (!existsSync(o.dduExe)) {
            o.progress(0, 0, 'Installing Display Driver Uninstaller');
            await o.adapter.exec(o.winget, ['install', '--id', 'Wagnardsoft.DisplayDriverUninstaller', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], 15 * 60_000);
            if (!existsSync(o.dduExe)) throw new Error(`Display Driver Uninstaller was not found at ${o.dduExe} after installing it.`);
          }
        }
        if (o.adapter.live && o.backup) {
          o.progress(0, 0, 'Backing up the installed drivers');
          await o.backup();
        }
        job.step = 'cleaning';
        job.message = `Removing the old driver with DDU; the PC restarts. After signing in, IcyTweaker opens: press Continue to install ${latest.version}.${dry}`;
        await save(job);
        await setLogonTask(o.adapter, DRIVER_TASK, o.resumeCommand); // elevated, at sign-in; removed after the install
        await o.log('driver-job', 'ddu', true, `${latest.version}${dry}`);
        await o.adapter.exec(o.dduExe, DDU_ARGS, 30 * 60_000);
      } catch (err) {
        job.step = 'failed';
        job.message = (err as Error).message;
        await save(job);
        await setLogonTask(o.adapter, DRIVER_TASK, null);
        await o.log('driver-job', 'begin', false, job.message);
      }
      return job;
    },

    /** After the restart: install the downloaded driver. */
    async resume(): Promise<DriverJobView | null> {
      const job = await read();
      if (!job || job.step !== 'cleaning') return job;
      job.step = 'installing';
      job.message = `Installing driver ${job.version}…`;
      await save(job);
      try {
        if (o.adapter.live) await verifySignature(o.adapter, job.installer, 'NVIDIA Corporation'); // the file sat on disk across a restart
        const r = await o.adapter.exec(job.installer, NVIDIA_INSTALL_ARGS, { timeoutMs: 30 * 60_000, okCodes: 'any' });
        // verify: NVIDIA's installer returns 0 on success (some versions return 1 = success, restart needed).
        if (r.code !== 0 && r.code !== 1) throw new Error(`The driver installer exited with code ${r.code}.`);
        job.step = 'done';
        job.message = `Driver ${job.version} installed${dry}. Restart to finish.`;
      } catch (err) {
        job.step = 'failed';
        job.message = `${(err as Error).message} Run the downloaded installer by hand: ${job.installer}`;
      }
      await setLogonTask(o.adapter, DRIVER_TASK, null);
      await save(job);
      await o.log('driver-job', 'install', job.step === 'done', job.message);
      return job;
    },

    /** Forget the job (and its RunOnce entry). The downloaded installer is kept for a manual install. */
    async clear() {
      await setLogonTask(o.adapter, DRIVER_TASK, null);
      await rm(file, { force: true });
    },
  };
}
