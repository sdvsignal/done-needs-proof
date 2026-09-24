---
name: prove
description: Use before telling the user that work is done, fixed, deployed, merged, or that tests pass. Pick the smallest check that proves the claim, run it after the last edit, and quote its output next to the claim. Say UNVERIFIED for anything you could not check.
---

# Prove it before you say it

A completion claim is only as good as the evidence next to it. Before you write "done", "fixed", "live", "merged" or "tests pass":

1. **Name the claim.** What exactly are you about to say is true?
2. **Pick the smallest check that would fail if the claim were false.**

   | Claim | Check |
   |---|---|
   | tests pass | run the suite (or the affected file) and keep the summary line |
   | fixed | reproduce the original failure, show it no longer fails |
   | deployed / live | `curl -sI <url>` and keep the status line |
   | merged / pushed | `git log origin/<branch> --oneline -3` |
   | builds | run the build and keep the last lines |

3. **Run it after your last edit.** A check that ran before the final change proves nothing about the final code.
4. **Quote the output.** Put the one or two lines that prove it next to the claim.
5. **Say what you could not check.** If something needs a device, a login or a human, write `UNVERIFIED:` and what would verify it. Do not round it up to "done".

## Why the Stop hook might block you

This plugin also installs a Stop hook. If your final message claims completion and no matching check ran in the same turn after your last edit, the hook blocks the stop and tells you which check is missing. Run the check and restate the result, or reword the message so it says what is still unverified. It fires once per stop; it will not loop.
