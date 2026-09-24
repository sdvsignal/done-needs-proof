# done-needs-proof

A Claude Code plugin that stops Claude from ending a turn on "done", "fixed", "deployed" or "tests pass" when nothing in the turn proves it.

It is a Stop hook. When Claude's final message makes a completion claim, the hook reads the session transcript and checks whether a matching verification ran after the last code edit: a test command for "tests pass", a `curl` or fetch for "deployed", a `git log` or `git status` for "merged", any of those for a plain "done". If the evidence is missing, the stop is blocked and Claude is told which check to run. If Claude then runs it, the message goes through with the output next to the claim. If Claude can't run it, the message has to say what is still unverified.

The check is local, deterministic and has no dependencies beyond Node 18+. Nothing leaves your machine.

## Install

Takes about 30 seconds.

```
claude plugin marketplace add sdvsignal/done-needs-proof
claude plugin install done-needs-proof@done-needs-proof
```

Or, without installing, try it for one session:

```
claude --plugin-dir /path/to/done-needs-proof
```

The plugin also ships a `prove` skill, which tells Claude to pick the smallest check that would fail if the claim were false and to quote its output.

## Before and after

Claude edits `src/auth.js`, does not run anything, and ends with:

> Fixed. The login bug is resolved.

Without the plugin, that is the end of the turn. With the plugin, the stop is blocked and Claude sees:

```
done-needs-proof: your last message says "Fixed", "resolved", but nothing since
your last code edit proves it. Either run the test, build or request that proves
it and quote the output, then restate the result with that output, or reword the
message to say plainly what is still unverified.
```

Claude then runs `npm test`, and the turn ends with:

> Fixed. `npm test`: 12 passing, 0 failing.

If the tests fail, or Claude cannot run them, the honest ending is:

> I changed the handler. UNVERIFIED: I could not run the suite here.

which the hook lets through.

## What counts as a claim

| Claim in the final message | Evidence required, run after the last code edit |
|---|---|
| tests pass, all green, CI green | a test command that succeeded and did not print "N failed" |
| deployed, is live, shipped, in production | a `curl`, `wget`, WebFetch, `gh run view`, or any command with a URL in it |
| merged, pushed, committed | a `git log`, `git status`, `git show`, `git commit`, `git push`, `git merge`, or `gh pr` command that succeeded |
| done, fixed, resolved, complete, works now, all set | any of the above, or a build, lint or type check |

Rules that keep it quiet:

- Conditional, negated or questioning sentences are not claims: "once tests pass", "not deployed yet", "is it fixed?".
- Text in code blocks, inline code, quotes and blockquotes is ignored.
- A plain "done" in a turn that edited no files is ignored. Strong claims (deployed, tests pass, merged) are checked in every turn.
- Editing a `.md` or `.txt` file does not invalidate evidence. Editing code does.
- Evidence from an earlier turn still counts if no code has changed since.
- The hook fires once per stop. On the second attempt it lets the turn end and prints a warning instead, so it cannot loop.
- Any internal error fails open. A bug in the hook never wedges a session.

On 753 real turns from this machine's own Claude Code sessions, the hook fired on 35 (4.6%), and each one was a completion claim with no matching check in the turn.

## Configure

Optional file at `.claude/done-needs-proof.json` in the project:

```json
{
  "mode": "block",
  "extraEvidence": ["scripts/smoke\\.sh", "make e2e"],
  "extraClaims": ["ready for review"]
}
```

- `mode`: `block` (default), `warn` (never blocks, prints the reason), or `off`.
- `extraEvidence`: regexes matched against Bash commands. A match counts as evidence for generic claims.
- `extraClaims`: regexes that count as generic completion claims.

`DONE_NEEDS_PROOF=warn` or `DONE_NEEDS_PROOF=off` in the environment overrides `mode` for one run.

## Check a saved transcript

```
node bin/check-transcript.js ~/.claude/projects/<project>/<session>.jsonl
```

Prints the verdict as JSON and exits 1 on a block. Useful for tuning the patterns against your own history.

## Tests

```
npm test
```

Covers the empty transcript, a claim with no evidence, a claim with evidence, stale evidence from before the last edit, failing test runs, deploy claims without an HTTP check, hedged sentences, config modes, and the hook script itself run end to end with a Stop payload on stdin.

## Limits

- It checks that a matching command ran and did not error. It does not read the code or judge whether the test was the right test.
- Claim detection is English-only regex. Add your own phrasing through `extraClaims`.
- MCP tool calls count as an external check, since the hook cannot see what they returned.

MIT licence.

Want this set up across your repos? kit.sdvsignal.com
