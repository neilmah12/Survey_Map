# Handoffs

One file per working session, so a new conversation can pick up where the last one stopped.

## How it works
- A handoff is a new dated file here: `YYYY-MM-DD-short-topic.md`. If two land on the same day, add `-2`.
- Never overwrite an older handoff. History stays readable, and the newest file is the one to follow.
- Starting a session: read the newest file in the index below, then `README.md` (features and decisions).
- Ending a session: add a new file, then update the index. Mark the previous entry `superseded` and leave its text alone.
- Each file starts with a status line (`current`, `superseded` or `done`), the branch and commit, and the session link.
- Pasteable prompt: the section after the header in each file is written to be pasted into a new conversation as is.
- Keep secrets out. Never put keys, tokens or passwords in a handoff.

## Index (newest first)
| Date | File | Status | Covers |
| --- | --- | --- | --- |
| 2026-10-26 | [2026-10-26-net-rent-and-dates.md](2026-10-26-net-rent-and-dates.md) | current | Net rent toggles, per-suite amounts, client net controls, vs-market popups, As of and last-edited dates. Next: Firebase. |
