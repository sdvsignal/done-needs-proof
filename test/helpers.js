'use strict';

// Tiny transcript builder so tests read like the conversation they model.
let n = 0;
const prompt = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
function run(command, output = '', isError = false) {
  const id = `toolu_${++n}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: isError }] } },
  ];
}
function edit(file = 'src/app.js') {
  const id = `toolu_${++n}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: file } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } },
  ];
}
const jsonl = (entries) => entries.map((e) => JSON.stringify(e)).join('\n');

module.exports = { prompt, say, run, edit, jsonl };
