#!/usr/bin/env node
'use strict';

// Run the check against a saved transcript without a live session:
//   node bin/check-transcript.js ~/.claude/projects/<project>/<session>.jsonl

const fs = require('fs');
const { evaluate, parseTranscript } = require('../lib/check');

const file = process.argv[2];
if (!file) {
  console.error('usage: check-transcript <transcript.jsonl>');
  process.exit(2);
}
const result = evaluate({ entries: parseTranscript(fs.readFileSync(file, 'utf8')) });
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'block' ? 1 : 0);
