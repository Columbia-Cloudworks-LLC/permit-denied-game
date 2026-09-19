import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readStdinJson } from '../../scripts/repo-preflight.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function inspectShellCommand(command, { exeHits = [] } = {}) {
  const text = String(command ?? '');
  if (!text.trim()) return { permission: 'allow' };
  const isGit = /\bgit\b/iu.test(text);
  if (!isGit) return { permission: 'allow' };

  const isAddOrCommit = /\b(add|commit)\b/iu.test(text);
  const mentionsBinary = /\.exe\b|[\\/]dist[\\/]|\bdist\\|\bdist\//iu.test(text);
  if (isAddOrCommit && mentionsBinary) {
    return {
      permission: 'deny',
      user_message: 'Do not stage or commit built binaries. dist/ and *.exe stay out of git (see .gitignore).',
      agent_message: 'Hook denied git add/commit of dist/ or *.exe. CI produces packages when needed. Do not commit the exe.',
    };
  }

  const addsWholeTree = /\badd\b/iu.test(text) && /(\s\.(?:\s|$)|-A\b|--all\b)/u.test(text);
  if (addsWholeTree && exeHits.length > 0) {
    const listed = exeHits.join(', ');
    return {
      permission: 'ask',
      user_message: `This git add may pick up ${listed}. Confirm they stay untracked.`,
      agent_message: `A hook flagged git add of the whole tree while ${listed} exists. Leave binaries untracked.`,
    };
  }

  if (/\bpush\b/iu.test(text) && /(?:\s|^)(?:--force\b|-f\b)/u.test(text)) {
    return {
      permission: 'ask',
      user_message: 'Force-push requires your review.',
      agent_message: 'A hook is asking the user to confirm this force-push.',
    };
  }

  return { permission: 'allow' };
}

export function existingBinaryHits(root = repoRoot) {
  const hits = [];
  if (existsSync(path.join(root, 'permitdenied.exe'))) hits.push('permitdenied.exe');
  if (existsSync(path.join(root, 'dist', 'permitdenied.exe'))) hits.push('dist/permitdenied.exe');
  return hits;
}

async function main() {
  try {
    const input = await readStdinJson();
    const command = input && typeof input.command === 'string' ? input.command : '';
    const decision = inspectShellCommand(command, { exeHits: existingBinaryHits() });
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ permission: 'allow' })}\n`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
