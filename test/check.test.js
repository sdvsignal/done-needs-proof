'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluate, parseTranscript, findClaims } = require('../lib/check');
const { prompt, say, run, edit, jsonl } = require('./helpers');

const check = (entries, extra = {}) => evaluate({ entries, ...extra });

test('empty transcript allows the stop', () => {
  assert.strictEqual(check([]).verdict, 'allow');
  assert.strictEqual(evaluate({ entries: parseTranscript('') }).verdict, 'allow');
});

test('corrupt transcript lines are skipped, not fatal', () => {
  const text = 'not json\n' + jsonl([prompt('fix it'), ...edit(), say('Fixed.')]) + '\n{"trunc';
  assert.strictEqual(evaluate({ entries: parseTranscript(text) }).verdict, 'block');
});

test('claim with no evidence is blocked', () => {
  const r = check([prompt('fix the login bug'), ...edit(), say('Fixed. The login bug is resolved.')]);
  assert.strictEqual(r.verdict, 'block');
  assert.match(r.reason, /nothing since your last code edit proves it/);
});

test('claim with passing tests after the edit is allowed', () => {
  const r = check([prompt('fix it'), ...edit(), ...run('npm test', '12 passing'), say('Fixed, tests pass.')]);
  assert.strictEqual(r.verdict, 'allow');
});

test('tests that ran before the last edit do not count', () => {
  const r = check([prompt('fix it'), ...run('npm test', '12 passing'), ...edit(), say('Done, all tests pass.')]);
  assert.strictEqual(r.verdict, 'block');
  assert.match(r.reason, /ran before that edit/);
});

test('a failing test run is not evidence', () => {
  const failedExit = check([prompt('x'), ...edit(), ...run('pytest', '2 failed, 10 passed', true), say('All tests pass now.')]);
  assert.strictEqual(failedExit.verdict, 'block');
  const maskedExit = check([prompt('x'), ...edit(), ...run('npm test || true', '3 failing'), say('Tests pass.')]);
  assert.strictEqual(maskedExit.verdict, 'block');
});

test('deploy claim needs an http check, not just tests', () => {
  const noCurl = check([prompt('ship it'), ...run('npm test', 'ok'), ...run('wrangler deploy', 'Uploaded'), say('Deployed, it is live.')]);
  assert.strictEqual(noCurl.verdict, 'block');
  assert.match(noCurl.reason, /curl the URL/);
  const withCurl = check([prompt('ship it'), ...run('wrangler deploy', 'Uploaded'), ...run('curl -sI https://example.com', 'HTTP/2 200'), say('Deployed, it is live.')]);
  assert.strictEqual(withCurl.verdict, 'allow');
});

test('deploy claim from memory with no tools at all is blocked', () => {
  const r = check([prompt('is the fix live?'), say('Yes, it is live in production.')]);
  assert.strictEqual(r.verdict, 'block');
});

test('merged claim needs git evidence', () => {
  assert.strictEqual(check([prompt('merge'), ...run('./merge.sh feat', 'ok'), say('Merged to main.')]).verdict, 'block');
  assert.strictEqual(check([prompt('merge'), ...run('git merge feat', 'Fast-forward'), say('Merged to main.')]).verdict, 'allow');
  assert.strictEqual(check([prompt('merge'), ...run('git merge feat', 'CONFLICT', true), say('Merged to main.')]).verdict, 'block');
  assert.strictEqual(check([prompt('merge'), ...run('git merge feat', 'ok'), ...run('git log main --oneline -3', 'abc123 feat'), say('Merged to main.')]).verdict, 'allow');
});

test('plain answers with no edits and a casual "done" are left alone', () => {
  const r = check([prompt('what does this function do?'), say("It parses the config. Here's what I've done: read the file and traced the call.")]);
  assert.strictEqual(r.verdict, 'allow');
});

test('hedged, conditional and negated claims are not claims', () => {
  assert.deepStrictEqual(findClaims('This is not deployed yet.'), []);
  assert.deepStrictEqual(findClaims('Once tests pass, I will merge it.'), []);
  assert.deepStrictEqual(findClaims('UNVERIFIED: whether it is live.'), []);
  assert.deepStrictEqual(findClaims('Is it fixed?'), []);
  assert.deepStrictEqual(findClaims('Run `git commit` when ready.'), []);
  assert.deepStrictEqual(findClaims('Each item gets a status: queued / shipped / re-tested.'), []);
  assert.deepStrictEqual(findClaims('I pushed hard on the pipeline design.'), []);
  assert.strictEqual(findClaims('Committed to main.')[0].category, 'git');
});

test('a message that only states what is unverified is allowed', () => {
  const r = check([prompt('fix it'), ...edit(), say('I changed the handler. UNVERIFIED: I could not run the suite here, so I have not confirmed it is fixed.')]);
  assert.strictEqual(r.verdict, 'allow');
});

test('only the latest turn is judged', () => {
  const r = check([prompt('one'), ...edit(), ...run('npm test', 'ok'), say('Fixed.'), prompt('thanks, now rename it'), ...edit(), say('Done.')]);
  assert.strictEqual(r.verdict, 'block');
});

test('last_assistant_message from the hook payload is used when present', () => {
  const r = evaluate({ entries: [prompt('x'), ...edit()], lastAssistantMessage: 'Fixed.' });
  assert.strictEqual(r.verdict, 'block');
});

test('extra evidence patterns from config count', () => {
  const entries = [prompt('x'), ...edit(), ...run('./scripts/smoke.sh', 'SMOKE OK'), say('Fixed.')];
  assert.strictEqual(check(entries).verdict, 'block');
  assert.strictEqual(check(entries, { config: { extraEvidence: ['scripts/smoke\\.sh'] } }).verdict, 'allow');
});

test('WebFetch counts as an http check', () => {
  const id = 'toolu_wf';
  const entries = [
    prompt('deploy'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'WebFetch', input: { url: 'https://x.dev' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: '200 OK' }] } },
    say('It is live.'),
  ];
  assert.strictEqual(check(entries).verdict, 'allow');
});

test('a result verified in an earlier turn still counts if nothing changed since', () => {
  const r = check([prompt('fix'), ...edit(), ...run('npm test', '12 passing'), say('Fixed, tests pass.'), prompt('status?'), say('Tests pass and the fix is in.')]);
  assert.strictEqual(r.verdict, 'allow');
});

test('editing only docs after the test run keeps the evidence', () => {
  const r = check([prompt('fix'), ...edit('src/a.js'), ...run('npm test', 'ok'), ...edit('README.md'), say('Fixed, tests pass.')]);
  assert.strictEqual(r.verdict, 'allow');
  const code = check([prompt('fix'), ...edit('src/a.js'), ...run('npm test', 'ok'), ...edit('src/b.js'), say('Fixed, tests pass.')]);
  assert.strictEqual(code.verdict, 'block');
});
