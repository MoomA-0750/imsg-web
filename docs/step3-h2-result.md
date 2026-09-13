# Step3 rung H2 — the Agent context resolves contacts too (2026-09-13)

M1 only. A temporary LaunchAgent, run once, booted out. The owner placed the
plist by hand: this environment refuses to create launchd plists, and that was
recorded rather than worked around.

## Why it had to be an Agent

H1 established that `--contacts-from-address-book` works when the responsible
process is `sshd`. Production's is the dedicated Node. The difference cannot be
probed over SSH at all — **everything descending from an SSH session is
attributed to sshd**, no matter what is launched further down — so the only way
to ask the question is to have launchd start the chain.

The deployment record already contains the shape of this trap: "SSH success does
not establish LaunchAgent permission."

## Result

```
ppid: 1                                    ← launchd, not a shell
node: …/runtime/node-v24.20.0-darwin-arm64/bin/node
child env keys: HOME,LANG,LC_ALL,PATH,TMPDIR
SSH_CONNECTION in this process: absent
product exit: code=0 signal=null
stderr bytes: 0
contacts.available: true
database.ready: true
database.path is the fixture: true
bridge.ready: false
version: 0.15.4
```

**`contacts.available: true` in the production chain**: launchd → dedicated Node
→ `imsg`, with the Phase C environment and nothing else. `ppid: 1` is the
evidence that launchd started it rather than a shell; the child environment is
exactly the five allow-listed names.

### The attribution flipped, which is the point

| | H1 (SSH) | H2 (Agent) |
|---|---|---|
| responsible process | `com.apple.sshd-keygen-wrapper` | **`node`**, on 27 lines |
| TCC lines naming `imsg` | 7 / 20 | 58 |
| services requested | all `kTCCServiceAddressBook` | 13 `kTCCServiceAddressBook`, 1 `kTCCServiceSystemPolicyAllFiles`, 1 `kTCCServiceDeveloperTool` |
| lines naming both `imsg` and a denial | 0 | **0** |

Two things worth separating. The responsible process **is** now `node` — that is
observed, and it is what makes this a different experiment from H1 rather than a
repeat of it. And a `kTCCServiceSystemPolicyAllFiles` request appears here where
H1 had none among imsg's requests, which is consistent with Full Disk Access on
the dedicated Node being what permits the file read. **Consistent with, not
proof of**: one request line does not establish the whole mechanism, and the
grant itself was never read.

## A broken probe that nearly became a finding

The first TCC query returned **0 lines total** — not zero `imsg` lines, zero
lines of any kind. Read carelessly that is "no permission machinery was
touched", which is a clean and completely wrong conclusion.

It was quoting. The predicate was passed through a nested `ssh` argument and the
remote shell reported `zsh:log:1: too many arguments`, which `2>/dev/null` had
hidden. Re-running with the script on stdin gave 199 lines.

The tell was that **even unrelated processes had produced nothing**, which no
real system state explains. Recorded because the same shape has now appeared
three times in this project: `command -v` in Phase A, the nine-file audit whose
paths did not exist, and this. In all three a probe's failure produced a
confident negative.

## Cleanup

`launchctl bootout` returned 0; the label is gone from `gui/501`; zero processes
remain from either the build root or the runtime. The fixture digest is
unchanged. Logs are 0600 — created as 0600 placeholders beforehand rather than
trusting the plist's `Umask`, which the runbook warns has behaved differently
across macOS versions. `err.log` is empty.

**The plist is still on disk.** Removing it is the owner's call, not an
automatic step.

## What this settles, and what it does not

Settled: the contact-source route works in the context production actually uses.
The candidate patch now has something to measure in both contexts, and no TCC
grant was requested, no prompt appeared, and nothing needs re-granting after a
rebuild.

Not settled: that Full Disk Access on the Node is *specifically* what permitted
it — the mechanism is consistent with the evidence, not demonstrated by it.
Nothing about Intel, whose execution remains undecided. Nothing about real
message data: the database was a fixture, and `chat.db` has still never been
opened by this project.
