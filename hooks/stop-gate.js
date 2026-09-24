#!/usr/bin/env node
'use strict';

// Stop hook. Reads the hook payload on stdin, checks the final assistant
// message for completion claims, and blocks the stop when a claim has no
// evidence in the same turn. Any internal error fails open (exit 0, no output)
// so a bug here can never wedge a session.

const fs = require('fs');
const path = require('path');
const { evaluate, parseTranscript } = require('../lib/check');

function loadConfig(cwd) {
  const cfg = { mode: 'block' };
  const file = path.join(cwd || process.cwd(), '.claude', 'done-needs-proof.json');
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    // No config file is the normal case.
  }
  if (process.env.DONE_NEEDS_PROOF) cfg.mode = process.env.DONE_NEEDS_PROOF;
  return cfg;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function main() {
  const input = JSON.parse(readStdin() || '{}');
  const cfg = loadConfig(input.cwd);
  if (cfg.mode === 'off') return;

  let transcript = '';
  try {
    if (input.transcript_path) transcript = fs.readFileSync(input.transcript_path, 'utf8');
  } catch (_) {
    // Missing transcript: judge on last_assistant_message alone.
  }

  const result = evaluate({
    entries: parseTranscript(transcript),
    lastAssistantMessage: input.last_assistant_message,
    config: cfg,
  });
  if (result.verdict !== 'block') return;

  // Already blocked once this stop cycle: let it stop, but tell the human.
  if (input.stop_hook_active || cfg.mode === 'warn') {
    process.stdout.write(JSON.stringify({ systemMessage: result.reason }));
    return;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: result.reason }));
}

try {
  main();
} catch (_) {
  process.exit(0);
}
