'use strict';

// Core logic for done-needs-proof. Pure functions, no I/O, so the tests can
// feed it transcripts directly.

// Claim categories. A claim in the final message needs evidence from the
// matching category, run in the same turn, after the last file edit.
const CLAIMS = {
  deploy: /\b(deployed|is live|now live|went live|live in prod(uction)?|in production|shipped)\b/i,
  tests: /\b(all |the )?tests? (now |all )?(pass|passes|passing|are green|is green)\b|\bgreen (test|build|ci)\b|\bci (is )?(green|passing)\b/i,
  git: /\b(merged|pushed|committed)(?=\s+(it|them|this|that|everything|all|the|to|into|on|in|as|and)\b|\s*[.:,;)]|\s*$)/i,
  generic: /\b(done|fixed|resolved|complete|completed|works now|working now|should work now|all set|ready to (ship|merge))\b/i,
};

const EVIDENCE = {
  tests: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bpytest\b|\bjest\b|\bvitest\b|\bgo test\b|\bcargo (test|nextest)\b|\bswift test\b|\bxcodebuild\b[^\n]*\btest\b|\bmvn\b[^\n]*\b(test|verify)\b|\bgradlew?\b[^\n]*\b(test|check)\b|\brspec\b|\bphpunit\b|\bnode --test\b|\bmake (test|check)\b|\bctest\b|\bdeno test\b|\btox\b|\bunittest\b|\bplaywright test\b|\bcypress run\b/i,
  http: /\bcurl\b|\bwget\b|\bhttpie\b|\bgh run (view|watch)\b|\bgh pr checks\b/i,
  git: /\bgit (log|status|show|rev-parse|ls-remote|branch|commit|push|merge)\b|\bgh (pr|api|repo) /i,
  build: /\b(npm|pnpm|yarn|bun)\s+run\s+(build|lint|typecheck|check|verify)\b|\btsc\b|\beslint\b|\bruff\b|\bmypy\b|\bcargo (build|check|clippy)\b|\bgo (build|vet)\b|\bxcodebuild\b|\bswift build\b|\bmake\b|\bnode --check\b|\bpy_compile\b|\bshellcheck\b/i,
};

// Which evidence satisfies which claim. Generic claims take any evidence.
const NEEDS = {
  deploy: ['http'],
  tests: ['tests'],
  git: ['git'],
  generic: ['tests', 'http', 'git', 'build', 'extra'],
};

const HINTS = {
  deploy: 'curl the URL and quote the status line',
  tests: 'run the test suite and quote the pass/fail summary',
  git: 'run git log --oneline -3 (or git status) and quote it',
  generic: 'run the test, build or request that proves it and quote the output',
};

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FETCH_TOOLS = new Set(['WebFetch']);

// Words just after a claim that negate it ("a green build isn't proof").
const HEDGE_AFTER = /^\W*(\w+\W+){0,2}(isn't|is not|doesn't|does not|proves nothing|is no proof|yet)\b/i;

// Words just before a claim that turn it into a condition, a question or a
// negation ("once tests pass", "not deployed yet", "before it's live").
const HEDGE_BEFORE = /\b(not|never|no|nothing|none|neither|without|isn't|aren't|wasn't|haven't|hasn't|didn't|won't|can't|cannot|if|once|until|before|unless|when|whether|after|yet to be|still|to be|need to be|needs to be|UNVERIFIED)\W+(\w+\W+){0,3}$/i;

function parseTranscript(text) {
  const entries = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (_) {
      // Partial or corrupt line. Skip it rather than fail the session.
    }
  }
  return entries;
}

function contentBlocks(entry) {
  const c = entry && entry.message && entry.message.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
}

function isRealPrompt(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain) return false;
  const blocks = contentBlocks(entry);
  if (!blocks.length) return false;
  return !blocks.some((b) => b && b.type === 'tool_result');
}

// Everything after the most recent human prompt.
function currentTurn(entries) {
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealPrompt(entries[i])) {
      start = i;
      break;
    }
  }
  return entries.slice(start + 1).filter((e) => !e.isSidechain);
}

function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && x.text) || '').join('\n');
  return '';
}

// Walk the turn in order. Returns the tool steps and the final assistant text.
function readTurn(turn) {
  const steps = [];
  const byId = new Map();
  let finalText = [];
  for (const entry of turn) {
    for (const b of contentBlocks(entry)) {
      if (!b) continue;
      if (entry.type === 'assistant' && b.type === 'tool_use') {
        const step = { id: b.id, name: b.name, input: b.input || {}, ok: null, output: '' };
        steps.push(step);
        byId.set(b.id, step);
        finalText = [];
      } else if (entry.type === 'user' && b.type === 'tool_result') {
        const step = byId.get(b.tool_use_id);
        if (step) {
          step.ok = b.is_error !== true;
          step.output = resultText(b);
        }
        finalText = [];
      } else if (entry.type === 'assistant' && b.type === 'text' && b.text) {
        finalText.push(b.text);
      }
    }
  }
  return { steps, finalText: finalText.join('\n') };
}

function stripQuoted(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^>.*$/gm, ' ')
    .replace(/"[^"\n]{0,200}"/g, ' ');
}

function findClaims(text, extraClaims) {
  const clean = stripQuoted(text);
  const sentences = clean.split(/(?<=[.!?\n])\s+/);
  const found = [];
  const patterns = Object.entries(CLAIMS).map(([k, re]) => [k, re]);
  for (const src of extraClaims || []) patterns.push(['generic', new RegExp(src, 'i')]);
  for (const s of sentences) {
    if (/\?\s*$/.test(s)) continue;
    for (const [cat, re] of patterns) {
      const m = s.match(re);
      if (!m) continue;
      const before = s.slice(0, m.index);
      const after = s.slice(m.index + m[0].length);
      // "queued / shipped / re-tested" is a list of states, not a claim.
      if (/\/\s*$/.test(before) || /^\s*\//.test(after)) continue;
      if (HEDGE_BEFORE.test(before) || HEDGE_AFTER.test(after)) continue;
      if (!found.some((f) => f.category === cat)) found.push({ category: cat, word: m[0].trim() });
    }
  }
  return found;
}

function evidenceKinds(step, extraEvidence) {
  const kinds = new Set();
  if (step.ok !== true) return kinds;
  // Fetching a URL or reading an external system through an MCP tool counts
  // as checking live state.
  if (FETCH_TOOLS.has(step.name) || String(step.name || '').startsWith('mcp__')) kinds.add('http');
  const cmd = step.name === 'Bash' ? String(step.input.command || '') : '';
  if (!cmd) return kinds;
  for (const [kind, re] of Object.entries(EVIDENCE)) if (re.test(cmd)) kinds.add(kind);
  if (/https?:\/\//i.test(cmd)) kinds.add('http');
  for (const src of extraEvidence || []) if (new RegExp(src, 'i').test(cmd)) kinds.add('extra');
  // A test command whose output reports failures is not evidence of passing.
  if (kinds.has('tests') && /\b[1-9]\d*\s+(failed|failing|failures?|errors?)\b/i.test(step.output)) {
    kinds.delete('tests');
  }
  return kinds;
}

// Edits to prose files don't invalidate a test run or a deploy check.
const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;

function isCodeEdit(step) {
  if (!EDIT_TOOLS.has(step.name)) return false;
  const file = String(step.input.file_path || step.input.notebook_path || '');
  return !DOC_FILE.test(file);
}

// Main entry. Returns { verdict: 'allow' | 'block', reason, claims, evidence }.
function evaluate({ entries, lastAssistantMessage, config }) {
  const cfg = config || {};
  const all = (entries || []).filter((e) => !e.isSidechain);
  const turn = readTurn(currentTurn(all));
  const text = lastAssistantMessage || turn.finalText;
  if (!text || !text.trim()) return { verdict: 'allow', reason: 'no final message', claims: [], evidence: [] };

  const claims = findClaims(text, cfg.extraClaims);
  if (!claims.length) return { verdict: 'allow', reason: 'no completion claim', claims, evidence: [] };

  // Evidence is read from the whole session, but only counts if it ran after
  // the last code edit. Tests that passed before the code changed prove
  // nothing about the code as it is now. A result verified in an earlier turn
  // with no edits since is still good, so status reports can repeat it.
  const { steps } = readTurn(all);
  let lastEdit = -1;
  steps.forEach((s, i) => {
    if (isCodeEdit(s)) lastEdit = i;
  });
  const fresh = new Set();
  steps.forEach((s, i) => {
    if (i > lastEdit) for (const k of evidenceKinds(s, cfg.extraEvidence)) fresh.add(k);
  });
  const turnEdited = turn.steps.some((s) => EDIT_TOOLS.has(s.name));

  const missing = claims.filter((c) => {
    // A generic "done" in a turn that edited nothing is usually describing
    // something else ("both packets are blocked or done"). Strong claims
    // (deployed, tests pass, merged) are checked in every turn.
    if (c.category === 'generic' && !turnEdited) return false;
    return !NEEDS[c.category].some((k) => fresh.has(k));
  });

  if (!missing.length) return { verdict: 'allow', reason: 'claims backed by evidence', claims, evidence: [...fresh] };

  const words = missing.map((c) => `"${c.word}"`).join(', ');
  const hints = [...new Set(missing.map((c) => HINTS[c.category]))].join('; ');
  const stale =
    lastEdit >= 0 &&
    steps.slice(0, lastEdit).some((s) => missing.some((c) => NEEDS[c.category].some((k) => evidenceKinds(s, cfg.extraEvidence).has(k))));
  const reason =
    `done-needs-proof: your last message says ${words}, but nothing since your last code edit proves it` +
    (stale ? ' (the matching check ran before that edit, so it no longer counts)' : '') +
    `. Either ${hints}, then restate the result with that output, or reword the message to say plainly what is still unverified.`;
  return { verdict: 'block', reason, claims: missing, evidence: [...fresh] };
}

module.exports = { evaluate, parseTranscript, findClaims, currentTurn, readTurn, evidenceKinds };
