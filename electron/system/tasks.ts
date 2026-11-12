// Elevated "at sign-in" scheduled tasks. Installed IcyTweaker always runs as administrator, and Windows does not
// start programs that need administrator from the Run / RunOnce registry keys; a scheduled task set to "run with
// highest privileges" is the supported way. Tasks run only for the current user, only when signed in (/IT).
import path from 'node:path';
import type { SystemAdapter } from './adapter';

export const SCHTASKS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe');
export const START_TASK = '\\IcyCleaner\\Start';
export const DRIVER_TASK = '\\IcyCleaner\\DriverJob';

export const currentUser = () => `${process.env.USERDOMAIN ?? '.'}\\${process.env.USERNAME ?? ''}`;

/** schtasks arguments for a logon task that runs `command` (a full command line) elevated for `user`. */
export const logonTaskArgs = (name: string, command: string, user: string) => ['/Create', '/TN', name, '/TR', command, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/IT', '/RU', user, '/F'];

/** Creates or replaces the task (command) or deletes it (null; a missing task is fine). Dry-run records it. */
export async function setLogonTask(adapter: Pick<SystemAdapter, 'exec'>, name: string, command: string | null, user = currentUser()) {
  if (command) await adapter.exec(SCHTASKS, logonTaskArgs(name, command, user), 30_000);
  else await adapter.exec(SCHTASKS, ['/Delete', '/TN', name, '/F'], 30_000).catch(() => {});
}
