#!/usr/bin/env node
// Regenerate repo-root PUBLISHED_PROJECT_URLS.txt from every client's projects.js.
//
// Two modes:
//   node .claude/gen_published_urls.mjs            -> regenerate now (direct/manual)
//   node .claude/gen_published_urls.mjs --from-hook -> read the Claude Code hook
//        JSON on stdin and regenerate ONLY when the tool command was a `git push`.
//
// Used both manually and as a PostToolUse hook so the file stays current on every
// push without anyone remembering to edit it. The file is a LOCAL reference
// (untracked); regenerating it never needs a commit.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENTS_DIR = join(REPO, 'site', 'clients');
const OUT = join(REPO, 'PUBLISHED_PROJECT_URLS.txt');
const BASE = 'https://viewer.enable-inc.com';

// Sandbox/dev folders that aren't real published clients.
const skipClient = (name) => /^Dev/i.test(name) || name === 'libs';

function loadProjects(jsPath) {
  // projects.js is `window.PROJECTS = {...}`. Eval it in a tiny sandbox.
  const code = readFileSync(jsPath, 'utf8');
  const sandbox = { window: {}, PROJECTS: undefined };
  vm.createContext(sandbox);
  try { vm.runInContext(code, sandbox, { timeout: 2000 }); } catch { return null; }
  return sandbox.window.PROJECTS || sandbox.PROJECTS || null;
}

function pad(s, n) { return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); }

function build() {
  const clients = readdirSync(CLIENTS_DIR)
    .filter((c) => { try { return statSync(join(CLIENTS_DIR, c)).isDirectory(); } catch { return false; } })
    .filter((c) => !skipClient(c))
    .filter((c) => existsSync(join(CLIENTS_DIR, c, 'projects.js')))
    .sort((a, b) => a.localeCompare(b));

  const blocks = [];
  for (const client of clients) {
    const projects = loadProjects(join(CLIENTS_DIR, client, 'projects.js'));
    if (!projects || typeof projects !== 'object') continue;
    const ids = Object.keys(projects);
    if (!ids.length) continue;
    const clientUrl = encodeURIComponent(client).replace(/%2F/g, '/'); // spaces -> %20
    const lines = ids.map((id) => {
      const name = (projects[id] && projects[id].name) ? String(projects[id].name) : id;
      return `  ${pad(name, 22)} ${BASE}/clients/${clientUrl}/viewer.html?p=${id}`;
    });
    blocks.push(`${client}\n${lines.join('\n')}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rule = '='.repeat(78);
  const dash = '-'.repeat(78);
  return [
    rule,
    ' ENABLE POINT CLOUD VIEWER — PUBLISHED PROJECT URLS',
    rule,
    ' Live site: https://viewer.enable-inc.com  (Netlify, auto-deploys from GitHub',
    ' branch `main` of Enable-inc-git/enable_point_cloud_viewer)',
    '',
    ' URL format:  https://viewer.enable-inc.com/clients/<Client>/viewer.html?p=<id>',
    '   - Spaces in the client folder name become %20',
    '   - Netlify is case-insensitive and works with or without ".html"',
    '',
    ` Last updated: ${today}`,
    ' AUTO-GENERATED from each client\'s projects.js by .claude/gen_published_urls.mjs',
    ' (runs after every `git push` via a PostToolUse hook). Dev/sandbox clients are',
    ' excluded. Do not hand-edit — change projects.js instead.',
    rule,
    '',
    `${dash.slice(0, 31)} CLIENT PROJECTS ${dash.slice(0, 31)}`,
    '',
    blocks.join('\n\n'),
    '',
  ].join('\n');
}

function regenerate() {
  const out = build();
  writeFileSync(OUT, out, 'utf8');
  return out;
}

const fromHook = process.argv.includes('--from-hook');
if (!fromHook) {
  regenerate();
  process.stdout.write(`Wrote ${OUT}\n`);
} else {
  // Hook mode: read the PostToolUse JSON, only act on `git push`.
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  let cmd = '';
  try { cmd = JSON.parse(data)?.tool_input?.command || ''; } catch { cmd = ''; }
  if (/\bgit\s+push\b/.test(cmd)) regenerate();
  process.exit(0);
}
