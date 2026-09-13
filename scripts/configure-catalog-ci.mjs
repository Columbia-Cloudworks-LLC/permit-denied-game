import { spawnSync } from 'node:child_process';

const repository = 'Columbia-Cloudworks-LLC/permit-denied-game';
// Use the Columbia connector identity explicitly; never fall back to the
// personal GitHub login or persist changes to the user's gh authentication.
const token = process.env['github-pat-cursor-columbia-cloudworks-llc'];
if (!token) throw new Error('Columbia GitHub connector credentials are unavailable');
const names = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
for (const name of names) if (!process.env[name]) throw new Error(`${name} is required`);
for (const name of names) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repository], {
    env: { ...process.env, GH_TOKEN: token }, input: process.env[name], encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Could not install ${name}; check repository-secret write permission`);
  console.log(`Installed repository secret: ${name}`);
}
const result = spawnSync('gh', ['secret', 'list', '--repo', repository, '--json', 'name'], {
  env: { ...process.env, GH_TOKEN: token }, encoding: 'utf8', windowsHide: true,
});
if (result.status !== 0) throw new Error('Could not verify repository secret names');
const installed = JSON.parse(result.stdout);
if (!names.every(name => installed.some(item => item.name === name))) throw new Error('Publishing secret verification failed');
console.log('Both R2 publishing secrets verified by name; no credentials printed');
