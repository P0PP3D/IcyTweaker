// Builds the Windows installer. When package.json has "updateRepo": "owner/name", the GitHub publish settings are
// passed too, so electron-builder writes release/latest.yml: upload it with the installer and its .blockmap to the
// GitHub release, and installed copies can update themselves. Nothing is uploaded from this PC: releases are built
// and published by .github/workflows/release.yml when a v* tag is pushed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [owner, repo] = (pkg.updateRepo ?? '').split('/');
// PUBLISH=always lets electron-builder upload itself. Not used: it created two releases per tag (parallel uploads);
// the release workflow builds with publish never and uploads all three files with one gh release create.
const publish = process.env.PUBLISH === 'always' ? 'always' : 'never';
const args = ['electron-builder', '--win', 'nsis', '--x64', '--publish', publish];
if (owner && repo) args.push(`-c.publish.provider=github`, `-c.publish.owner=${owner}`, `-c.publish.repo=${repo}`, '-c.publish.releaseType=release');
else console.log('No "updateRepo" in package.json: building without update metadata (auto-update stays off).');
args.push(...process.argv.slice(2)); // e.g. --config.directories.output=release/next when release\win-unpacked is locked

const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
