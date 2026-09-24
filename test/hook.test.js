'use strict';

// End-to-end: run the real hook script the way Claude Code does, with the
// payload on stdin, and check what it prints.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { prompt, say, run, edit, jsonl } = require('./helpers');

const HOOK = path.join(__dirname, '..', 'hooks', 'stop-gate.js');

function fire(entries, extra = {}, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-'));
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, jsonl(entries));
  const payload = { hook_event_name: 'Stop', transcript_path: transcript, cwd: dir, stop_hook_active: false, ...extra };
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, dir };
}

test('hook blocks an unproven claim', () => {
  const r = fire([prompt('fix'), ...edit(), say('Fixed.')]);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.decision, 'block');
});

test('hook is silent when the claim is proven', () => {
  const r = fire([prompt('fix'), ...edit(), ...run('npm test', 'ok'), say('Fixed.')]);
  assert.strictEqual(r.out, null);
});

test('hook does not loop: second stop only warns', () => {
  const r = fire([prompt('fix'), ...edit(), say('Fixed.')], { stop_hook_active: true });
  assert.strictEqual(r.out.decision, undefined);
  assert.match(r.out.systemMessage, /done-needs-proof/);
});

test('empty stdin and missing transcript fail open', () => {
  const empty = spawnSync('node', [HOOK], { input: '', encoding: 'utf8' });
  assert.strictEqual(empty.status, 0);
  assert.strictEqual(empty.stdout, '');
  const missing = spawnSync('node', [HOOK], { input: JSON.stringify({ transcript_path: '/nope/x.jsonl' }), encoding: 'utf8' });
  assert.strictEqual(missing.status, 0);
  assert.strictEqual(missing.stdout, '');
  const garbage = spawnSync('node', [HOOK], { input: '{not json', encoding: 'utf8' });
  assert.strictEqual(garbage.status, 0);
});

test('config file can switch to warn or off', () => {
  const entries = [prompt('fix'), ...edit(), say('Fixed.')];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-cfg-'));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'done-needs-proof.json'), '{"mode":"warn"}');
  const r = fire(entries, { cwd: dir });
  assert.ok(r.out.systemMessage && !r.out.decision);
  const off = fire(entries, {}, { DONE_NEEDS_PROOF: 'off' });
  assert.strictEqual(off.out, null);
});
