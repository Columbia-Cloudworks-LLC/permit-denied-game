import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hookCommand, inspectShellCommand, toHookOutput } from '../.claude/hooks/shell-guard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('settings.json registers cross-platform Node hooks and does not launch powershell.exe', async () => {
  const settings = JSON.parse(await readFile(path.join(repoRoot, '.claude/settings.json'), 'utf8'));
  const session = settings.hooks.SessionStart;
  assert.equal(session.length, 1);
  assert.equal(session[0].hooks[0].command, 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.mjs"');
  assert.equal(session[0].hooks[0].timeout >= 20, true);
  const guard = settings.hooks.PreToolUse.find((entry) => /\bBash\b/u.test(entry.matcher));
  assert.ok(guard, 'PreToolUse guard covers Bash');
  assert.match(guard.matcher, /PowerShell/u);
  assert.equal(guard.hooks[0].command, 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/shell-guard.mjs"');
  const encoded = JSON.stringify(settings);
  assert.doesNotMatch(encoded, /powershell\.exe/i);
  assert.doesNotMatch(encoded, /gofmt|go test|Ebitengine|build\.bat/i);
});

test('committed hook files do not inject Go/Ebitengine or one-lot guidance', async () => {
  const dir = path.join(repoRoot, '.claude/hooks');
  const names = await readdir(dir);
  const sources = [];
  for (const name of names) {
    if (!/\.(mjs|md|json|ps1)$/u.test(name)) continue;
    sources.push(await readFile(path.join(dir, name), 'utf8'));
  }
  const blob = sources.join('\n');
  assert.doesNotMatch(blob, /Ebitengine/i);
  assert.doesNotMatch(blob, /go test \.\/\.\.\./i);
  assert.doesNotMatch(blob, /go run \.\/cmd/i);
  assert.doesNotMatch(blob, /build\.bat/i);
  assert.doesNotMatch(blob, /one-lot/i);
  assert.match(blob, /TypeScript \+ Vite \+ PixiJS/);
});

test('shell-guard denies dist/exe commits, asks on force-push, and allows ordinary git', () => {
  assert.equal(inspectShellCommand('git add src/main.ts').permission, 'allow');
  assert.equal(inspectShellCommand('git add dist/index.html').permission, 'deny');
  assert.equal(inspectShellCommand('git commit -m ship -- dist/game.exe').permission, 'deny');
  assert.equal(inspectShellCommand('git push --force origin topic').permission, 'ask');
  assert.equal(inspectShellCommand('git push -f').permission, 'ask');
  assert.equal(inspectShellCommand('git add .', { exeHits: ['dist/permitdenied.exe'] }).permission, 'ask');
  assert.equal(inspectShellCommand('npm test').permission, 'allow');
});

test('shell-guard checks git arguments, not message text or unrelated commands', () => {
  const allow = (command, options) => assert.equal(inspectShellCommand(command, options).permission, 'allow', command);
  const deny = (command) => assert.equal(inspectShellCommand(command).permission, 'deny', command);
  const ask = (command, options) => assert.equal(inspectShellCommand(command, options).permission, 'ask', command);

  // Messages and prose that mention the guarded paths.
  allow('git commit -m "guard dist/ and *.exe from git add"');
  allow("git commit -am 'stop git add of dist/game.exe'");
  allow('git commit --message="add dist/ checks"');
  allow('git add src/a.ts && git commit -F msg.txt');
  allow("git commit -q -F - <<'EOF'\nPreToolUse (dist/exe guard): git add dist/x is denied\nEOF\ngit push -u origin topic");
  allow("git commit -m @'\nblocks git add dist/x\n'@");
  allow('echo git add dist/x');
  allow('rg -n "git add dist/" scripts');
  allow('node -e "x" # git add dist/x');
  allow('git log --oneline -- dist/');
  allow('git -c safe.directory=D:/repos/dist/x add src/main.ts');

  // Real binary staging, however it is spelled.
  deny('git add dist');
  deny('git add -f "dist\\index.html"');
  deny('npm run build && git add -f dist/index.html');
  deny('git -c safe.directory=D:/x -C repo add permitdenied.exe');
  deny('& git.exe add "C:/repo/dist/app.js"');
  deny('git commit -m ok -- src/a.ts dist/game.exe');
  deny('git add \\\n  dist/index.html');

  ask('git push --force-with-lease origin topic');
  ask('git push -uf origin topic');
  ask('git push origin +topic');
  allow('git push -u origin topic');
  allow('git commit -m "--force push notes" && git push');
  ask('git add -A', { exeHits: ['permitdenied.exe'] });
  allow('git add -A');
});

test('shell-guard emits Claude Code PreToolUse output only for deny and ask', () => {
  assert.equal(toHookOutput(inspectShellCommand('git status')), null);
  const denied = toHookOutput(inspectShellCommand('git add dist/index.html'));
  assert.equal(denied.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /binar|dist/i);
  const asked = toHookOutput(inspectShellCommand('git push --force origin topic'));
  assert.equal(asked.hookSpecificOutput.permissionDecision, 'ask');
});

test('shell-guard reads the command from a PreToolUse payload and ignores other tools', () => {
  assert.equal(hookCommand({ tool_input: { command: 'git push -f' } }), 'git push -f');
  assert.equal(hookCommand({ tool_input: { file_path: 'a.ts' } }), '');
  assert.equal(hookCommand(null), '');
});
