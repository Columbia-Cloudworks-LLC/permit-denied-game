import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readStdinJson } from '../../scripts/repo-preflight.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Drop heredoc bodies (bash `<<EOF` / `<<'EOF'` / `<<-EOF`) and PowerShell
// here-strings (`@'...'@`, `@"..."@`). They carry commit messages and file
// contents, never git arguments.
export function stripHeredocs(text) {
  const withoutHereStrings = text.replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/gu, "''");
  const out = [];
  const pending = [];
  let open = null;
  for (const line of withoutHereStrings.split(/\r?\n/u)) {
    if (open) {
      if ((open.dash ? line.replace(/^\t+/u, '') : line) === open.word) open = pending.shift() ?? null;
      continue;
    }
    out.push(line);
    for (const match of line.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/gu)) {
      pending.push({ dash: match[1] === '-', word: match[3] });
    }
    open = pending.shift() ?? null;
  }
  return out.join('\n');
}

// Split into simple commands on ; & && || | and newlines, honoring quotes,
// comments, and line continuations. Returns one token array per command.
export function splitCommands(text) {
  const commands = [];
  let tokens = [];
  let word = '';
  let inWord = false;
  const endWord = () => {
    if (inWord) tokens.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (tokens.length) commands.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if ((ch === '\\' || ch === '`') && (next === '\n' || (next === '\r' && text[i + 2] === '\n'))) {
      i += next === '\r' ? 2 : 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1);
      const end = close === -1 ? text.length : close;
      word += text.slice(i + 1, end);
      inWord = true;
      i = end;
      continue;
    }
    if (ch === '#' && !inWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') {
      endCommand();
      continue;
    }
    if (/\s/u.test(ch)) {
      endWord();
      continue;
    }
    word += ch;
    inWord = true;
  }
  endCommand();
  return commands;
}

const COMMAND_PREFIXES = new Set(['{', '(', '!', 'then', 'do', 'else', 'time', 'sudo', 'command', 'exec', 'nohup']);
const GIT_GLOBAL_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
// Options that consume the following token (or the rest of a short cluster).
const VALUE_OPTIONS = {
  add: { short: '', long: ['--pathspec-from-file', '--chmod'] },
  commit: {
    short: 'mFCct',
    long: ['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date', '--fixup', '--squash', '--cleanup', '--template', '--trailer', '--pathspec-from-file'],
  },
  push: { short: 'o', long: ['--push-option', '--receive-pack', '--exec', '--repo'] },
};

// Parse a git invocation into its subcommand, flags, and positional arguments.
export function parseGit(tokens) {
  let i = 0;
  while (i < tokens.length && (COMMAND_PREFIXES.has(tokens[i]) || /^[A-Za-z_]\w*=/u.test(tokens[i]))) i += 1;
  if (!/^git(?:\.exe)?$/iu.test(path.basename(tokens[i] ?? '').replace(/^\(/u, ''))) return null;
  i += 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += GIT_GLOBAL_VALUE_OPTIONS.has(tokens[i]) ? 2 : 1;
  }
  const subcommand = tokens[i];
  if (!subcommand) return null;
  const spec = VALUE_OPTIONS[subcommand] ?? { short: '', long: [] };
  const flags = [];
  const args = [];
  let pathsOnly = false;
  for (i += 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (pathsOnly || !token.startsWith('-') || token === '-') {
      args.push(token);
    } else if (token === '--') {
      pathsOnly = true;
    } else if (token.startsWith('--')) {
      flags.push(token.split('=')[0]);
      if (!token.includes('=') && spec.long.includes(token)) i += 1;
    } else {
      const cluster = token.slice(1);
      const valueAt = [...cluster].findIndex((c) => spec.short.includes(c));
      const letters = valueAt === -1 ? cluster : cluster.slice(0, valueAt + 1);
      for (const c of letters) flags.push(`-${c}`);
      if (valueAt === cluster.length - 1) i += 1;
    }
  }
  return { subcommand, flags, args };
}

const isBinaryPath = (arg) => /(?:^|[\\/])dist(?:[\\/]|$)/iu.test(arg) || /\.exe$/iu.test(arg);

export function inspectShellCommand(command, { exeHits = [] } = {}) {
  const text = String(command ?? '');
  if (!text.trim()) return { permission: 'allow' };
  let ask = null;
  for (const tokens of splitCommands(stripHeredocs(text))) {
    const git = parseGit(tokens);
    if (!git) continue;
    const { subcommand, flags, args } = git;

    if ((subcommand === 'add' || subcommand === 'commit') && args.some(isBinaryPath)) {
      return {
        permission: 'deny',
        user_message: 'Do not stage or commit built binaries. dist/ and *.exe stay out of git (see .gitignore).',
        agent_message: 'Hook denied git add/commit of dist/ or *.exe. CI produces packages when needed. Do not commit the exe.',
      };
    }

    const addsWholeTree = subcommand === 'add'
      && (flags.includes('-A') || flags.includes('--all') || args.some((arg) => arg === '.' || arg === ':/'));
    if (addsWholeTree && exeHits.length > 0) {
      const listed = exeHits.join(', ');
      ask ??= {
        permission: 'ask',
        user_message: `This git add may pick up ${listed}. Confirm they stay untracked.`,
        agent_message: `A hook flagged git add of the whole tree while ${listed} exists. Leave binaries untracked.`,
      };
    }

    const forces = flags.some((flag) => flag === '-f' || flag.startsWith('--force')) || args.some((arg) => arg.startsWith('+'));
    if (subcommand === 'push' && forces) {
      ask ??= {
        permission: 'ask',
        user_message: 'Force-push requires your review.',
        agent_message: 'A hook is asking the user to confirm this force-push.',
      };
    }
  }
  return ask ?? { permission: 'allow' };
}

export function existingBinaryHits(root = repoRoot) {
  const hits = [];
  if (existsSync(path.join(root, 'permitdenied.exe'))) hits.push('permitdenied.exe');
  if (existsSync(path.join(root, 'dist', 'permitdenied.exe'))) hits.push('dist/permitdenied.exe');
  return hits;
}

// Claude Code PreToolUse output. "allow" prints nothing so the user's normal
// permission prompts still apply; only deny/ask are forwarded.
export function toHookOutput(decision) {
  if (decision.permission === 'allow') return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.permission,
      permissionDecisionReason: decision.permission === 'deny' ? decision.agent_message : decision.user_message,
    },
  };
}

async function main() {
  try {
    const input = await readStdinJson();
    const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
    const output = toHookOutput(inspectShellCommand(command, { exeHits: existingBinaryHits() }));
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // Fail open.
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
