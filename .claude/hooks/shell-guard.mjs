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

/// Split into simple commands on ; & && || | and newlines, honoring quotes,
// comments, and line continuations. Returns one token array per command.
export function splitCommands(text) {
  const lexer = new CommandLexer(text);
  for (let i = 0; i < text.length; i += 1) i = lexer.read(i);
  lexer.endCommand();
  return lexer.commands;
}

const SEPARATORS = new Set([';', '&', '|', '\n']);

/** A backslash (bash) or backtick (PowerShell) right before a line break joins the lines. */
function isContinuation(text, i) {
  const ch = text[i];
  const next = text[i + 1];
  return (ch === '\\' || ch === '`') && (next === '\n' || (next === '\r' && text[i + 2] === '\n'));
}

class CommandLexer {
  commands = [];
  tokens = [];
  word = '';
  inWord = false;

  constructor(text) {
    this.text = text;
  }

  endWord() {
    if (this.inWord) this.tokens.push(this.word);
    this.word = '';
    this.inWord = false;
  }

  endCommand() {
    this.endWord();
    if (this.tokens.length) this.commands.push(this.tokens);
    this.tokens = [];
  }

  /** Consume the character at i and anything it owns; returns the last index consumed. */
  read(i) {
    const { text } = this;
    const ch = text[i];
    if (isContinuation(text, i)) return i + (text[i + 1] === '\r' ? 2 : 1);
    if (ch === "'" || ch === '"') return this.readQuoted(i, ch);
    if (ch === '#' && !this.inWord) return lineEnd(text, i);
    if (SEPARATORS.has(ch)) this.endCommand();
    else if (/\s/u.test(ch)) this.endWord();
    else {
      this.word += ch;
      this.inWord = true;
    }
    return i;
  }

  /** A quoted run joins the current word without its quotes; an unclosed quote runs to the end. */
  readQuoted(i, quote) {
    const close = this.text.indexOf(quote, i + 1);
    const end = close === -1 ? this.text.length : close;
    this.word += this.text.slice(i + 1, end);
    this.inWord = true;
    return end;
  }
}

/** The index just before the next newline, so a comment ends at its line. */
function lineEnd(text, i) {
  while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
  return i;
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
const NO_VALUE_OPTIONS = { short: '', long: [] };

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
  return { subcommand, ...parseGitArguments(tokens, i + 1, VALUE_OPTIONS[subcommand] ?? NO_VALUE_OPTIONS) };
}

/** Sort a subcommand's tokens into flags and arguments, skipping option values. */
function parseGitArguments(tokens, start, spec) {
  const flags = [];
  const args = [];
  let pathsOnly = false;
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (pathsOnly || !token.startsWith('-') || token === '-') args.push(token);
    else if (token === '--') pathsOnly = true;
    else i += readFlag(token, spec, flags);
  }
  return { flags, args };
}

/** Record a long flag or each letter of a short cluster; returns 1 when the next token is its value. */
function readFlag(token, spec, flags) {
  if (token.startsWith('--')) {
    flags.push(token.split('=')[0]);
    return !token.includes('=') && spec.long.includes(token) ? 1 : 0;
  }
  const cluster = token.slice(1);
  const valueAt = [...cluster].findIndex((c) => spec.short.includes(c));
  const letters = valueAt === -1 ? cluster : cluster.slice(0, valueAt + 1);
  for (const c of letters) flags.push(`-${c}`);
  return valueAt === cluster.length - 1 ? 1 : 0;
}

const isBinaryPath = (arg) => /(?:^|[\\/])dist(?:[\\/]|$)/iu.test(arg) || /\.exe$/iu.test(arg);

const DENY_BINARIES = {
  permission: 'deny',
  user_message: 'Do not stage or commit built binaries. dist/ and *.exe stay out of git (see .gitignore).',
  agent_message: 'Hook denied git add/commit of dist/ or *.exe. CI produces packages when needed. Do not commit the exe.',
};
const ASK_FORCE_PUSH = {
  permission: 'ask',
  user_message: 'Force-push requires your review.',
  agent_message: 'A hook is asking the user to confirm this force-push.',
};

export function inspectShellCommand(command, { exeHits = [] } = {}) {
  const text = String(command ?? '');
  if (!text.trim()) return { permission: 'allow' };
  let ask = null;
  for (const tokens of splitCommands(stripHeredocs(text))) {
    const git = parseGit(tokens);
    const decision = git && inspectGit(git, exeHits);
    if (decision?.permission === 'deny') return decision;
    ask ??= decision;
  }
  return ask ?? { permission: 'allow' };
}

/** Deny staging binaries; ask before adding the whole tree beside one, or before a force-push. */
function inspectGit({ subcommand, flags, args }, exeHits) {
  if ((subcommand === 'add' || subcommand === 'commit') && args.some(isBinaryPath)) return DENY_BINARIES;
  const addsWholeTree = subcommand === 'add'
    && (flags.includes('-A') || flags.includes('--all') || args.some((arg) => arg === '.' || arg === ':/'));
  if (addsWholeTree && exeHits.length > 0) {
    const listed = exeHits.join(', ');
    return {
      permission: 'ask',
      user_message: `This git add may pick up ${listed}. Confirm they stay untracked.`,
      agent_message: `A hook flagged git add of the whole tree while ${listed} exists. Leave binaries untracked.`,
    };
  }
  const forces = flags.some((flag) => flag === '-f' || flag.startsWith('--force')) || args.some((arg) => arg.startsWith('+'));
  return subcommand === 'push' && forces ? ASK_FORCE_PUSH : null;
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

/** The Bash tool's command from a PreToolUse payload, or empty for anything else. */
export function hookCommand(input) {
  const command = input?.tool_input?.command;
  return typeof command === 'string' ? command : '';
}

async function main() {
  try {
    const output = toHookOutput(inspectShellCommand(hookCommand(await readStdinJson()), { exeHits: existingBinaryHits() }));
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // Fail open.
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
