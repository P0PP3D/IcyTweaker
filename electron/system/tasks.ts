// Elevated "at sign-in" scheduled tasks. Installed IcyTweaker always runs as administrator, and Windows does not
// start programs that need administrator from the Run / RunOnce registry keys; a scheduled task set to "run with
// highest privileges" is the supported way. Tasks run only for the current user, only when signed in (/IT).
import path from 'node:path';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

export const SCHTASKS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe');
export const START_TASK = '\\IcyCleaner\\Start';
export const DRIVER_TASK = '\\IcyCleaner\\DriverJob';

export const currentUser = () => `${process.env.USERDOMAIN ?? '.'}\\${process.env.USERNAME ?? ''}`;

/** schtasks arguments for a logon task that runs `command` (a full command line) elevated for `user`. */
export const logonTaskArgs = (name: string, command: string, user: string) => ['/Create', '/TN', name, '/TR', command, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/IT', '/RU', user, '/F'];

/** Sets a task (e.g. \IcyCleaner\Start) to normal priority (4). */
export const taskPriorityScript = (name: string) => {
  const i = name.lastIndexOf('\\');
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return `$t = Get-ScheduledTask -TaskPath ${q(name.slice(0, i + 1))} -TaskName ${q(name.slice(i + 1))} -ErrorAction Stop; $t.Settings.Priority = 4; Set-ScheduledTask -InputObject $t -ErrorAction Stop | Out-Null`;
};

/** Started by the desktop / Start menu shortcuts: opens the app as administrator without a UAC prompt. */
export const OPEN_TASK = '\\IcyCleaner\\Open';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The Open task: no trigger (run on demand), elevated, only in `user`'s session. Parallel: the shortcut must still
 * work while the copy it started earlier runs in the tray (the new copy hands over and quits). Priority 4 = normal
 * (a task's default, 7, is below normal). Write it as UTF-16 for schtasks /XML.
 */
export const openTaskXml = (exe: string, user: string) => `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Principals><Principal id="Author"><UserId>${xmlEscape(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>4</Priority></Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(exe)}</Command></Exec></Actions>
</Task>
`;

/** Creates or replaces the task (command) or deletes it (null; a missing task is fine). Dry-run records it. */
export async function setLogonTask(adapter: Pick<SystemAdapter, 'exec'>, name: string, command: string | null, user = currentUser()) {
  if (command) {
    await adapter.exec(SCHTASKS, logonTaskArgs(name, command, user), 30_000);
    // schtasks can't set a priority, and a task's default (7) runs the app below normal all session long.
    await adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', taskPriorityScript(name)], 30_000).catch(() => {}); // stays 7: still works
  } else await adapter.exec(SCHTASKS, ['/Delete', '/TN', name, '/F'], 30_000).catch(() => {});
}
