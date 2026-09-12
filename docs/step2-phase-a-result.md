# Step2 Phase A — pass 1 result (2026-09-12)

Read-only discovery pass executed against both retained Mac environments with
owner authorization. **`imsg` was not invoked. No dedicated Node was executed.
Nothing was created, moved, deleted, signalled or configured.** Both logs ended
with the completeness marker, so neither run was truncated.

Raw output was redirected to a private file outside both git repositories and
was never read by the agent; only derived verdicts were surfaced. Host names,
user names, absolute paths, agent labels, PIDs and macOS versions are recorded
in the owner's Vault note, not here.

**Phase A stops here.** Several abort conditions in
`docs/step2-phase-a-inventory-plan.md` are met. Pass 2 is not generated and no
artifact is admitted until the owner has decided on the findings below.

## Execution facts

| | Intel host | M1 host |
|---|---|---|
| Completeness marker | present | present |
| Base directory | present, `0700`, owned by the SSH user | same |
| Command Line Tools | available | available |
| Base tree entries (depth ≤ 4) | 209 | 209 |
| Executable files in base | 1 | 1 |
| Dylibs in base | 0 | 0 |
| Dedicated Node runtime | present (darwin-x64) | present (darwin-arm64) |
| Retained Node **archive** | none | none |
| Retained app releases | `9b64d36-p0c1`, `a342425` | `9b64d36-p0c1`, `a342425` |
| Permission denials in project scope | none | none |

Two predictions from the pre-execution review were confirmed on real hardware,
and both would have produced a wrong inventory in the first draft of this plan:

- `command -v imsg` returned **exit 1 on both hosts**, exactly as predicted,
  because `sshd` gives a non-interactive shell a default `PATH` that excludes
  every Homebrew prefix. The absolute-path probes are what actually found the
  binaries. A plan that trusted `command -v` would have recorded "imsg absent"
  on both machines.
- Both Homebrew entries are **symbolic links to a 67/70-byte Bourne-Again shell
  wrapper**, and the wrapper text was only readable because the type check
  follows links. `file -b` alone would have reported "symbolic link", failed the
  text gate, and skipped the wrapper body — while `shasum` read through the link
  anyway, mixing link and target in one record.

Both wrappers `exec` a versioned `libexec` image, as the records expected. The
wrapper path is not the executable image and is not recorded as one.

## Finding 1 — the M1 host's stock imsg is no longer 0.15.1

**The M1 Homebrew wrapper now targets imsg `0.15.3`.** Its link and wrapper are
dated 2026-09-11, one day before this inventory and after every recorded
checkpoint. The Intel host remains at `0.14.2`, matching the records.

This is the most consequential result of Phase A. Everything in step2 so far
assumed `0.15.1`:

- the pinned source audit of call paths, `invokeWithoutLaunching`, the SSH
  AddressBook fallback and the read-only `MessageStore`, all read at `646ea7a`;
- the stored contact-batch patch, which applies to `646ea7a`;
- the recorded `Package.resolved` and candidate/release digests for M1.

The upgrade was not performed by this work. **Assessed at source level in
`docs/imsg-0153-upgrade-assessment.md`**, and the outcome is better than this
section first assumed: all nine audited files are byte-identical between the two
versions, the changes are confined to the launching path, and the stored
contact-batch patch applies cleanly to 0.15.3. The one initializer change that
could have added a write to the no-launch path was checked and is inert.

The recommendation is to re-pin the audit to 0.15.3. Reverting is unnecessary,
and separately unavailable: pass 1b found the M1 Cellar retains only `0.15.3`,
so `0.15.1` is no longer on that machine.

Nothing was changed, downgraded or reinstalled in response. Source analysis is
not provenance, and behavioural equivalence between the two versions has not
been demonstrated — that would require executing imsg.

## Finding 2 — an imsg process is running on the Intel host

Three user LaunchAgents in the owner's own namespace, belonging to a **separate
AI-reply watcher system** (not this project), are present on disk and **loaded**.
One is a running Python process that has been alive for about eight days, and it
has a **child process that is the stock `0.14.2` `libexec` imsg image**, alive
for about the same period.

So on the Intel host, at this moment, a long-lived `imsg` process exists that
this project does not own. This is the concrete reason the handoff forbids broad
`imsg` process cleanup, and it was previously recorded only as "a watcher.py is
running", without the detail that it holds a live imsg child.

Consequences that must be carried into later phases:

- Any absence or residue observation on that host will see a foreign `imsg`
  process. "No imsg running" is not a valid expectation there.
- Any performance measurement on that host shares the machine, and possibly the
  bridge, with this process. It is a confound, not background noise.
- The bounded four-field projection used in this pass did **not** match it: the
  agent's command line does not literally contain the script's filename, so the
  watcher was found through `launchctl`, not through the process filter. The
  filter is not wrong, but it is not sufficient on its own.

Nothing was stopped, signalled, unloaded, edited or inspected beyond process
identity. The watcher's script contents were not read.

## Finding 3 — the M1 build tree was not found

The baseline/candidate build tree on the M1 host, whose path was never recorded,
was **not located** under the temporary root within the bounded search. The only
candidate directory that could not be enumerated is a directory with an unusual
write-only mode that denied traversal.

This is recorded as "not found". It is **not** concluded that the tree was
deleted, and nothing was removed, remounted or chmod-ed in response. The Intel
host, by contrast, still has its build tree, containing `baseline`, `candidate`
and a third `candidate-r3` tree that the records do not mention.

## Finding 4 — withdrawn: both hosts report no serve configuration

**Pass 1 was wrong about this, and the error was mine.** It concluded "no
Tailscale CLI" on the Intel host from two probes, one of which (`command -v`)
depends on the very `PATH` this plan deliberately narrows, and the other of
which checked only the application bundle. A wider probe in pass 1b found the
CLI immediately, under the Homebrew prefix.

Queried with the resolved path, **both hosts report no serve configuration**,
matching the records. Serve state is established and empty on both.

The lesson is recorded rather than quietly fixed: a negative result from a probe
whose failure mode is already known is not evidence of absence. The same
reasoning that made `command -v imsg` untrustworthy applied to `tailscale` one
section earlier, and pass 1 did not carry it across.

## Pass 1b — follow-up answers

Targeted read-only follow-up, same contract and same generator.

- **Intel Tailscale CLI**: present under the Homebrew prefix. Finding 4 withdrawn.
- **Retained imsg versions**: the Intel host's Cellar holds only `0.14.2`; the M1
  host's holds only `0.15.3`. **`0.15.1` is gone** — Homebrew removed the
  superseded version on upgrade — so a local downgrade on the M1 is not
  available. See `docs/imsg-0153-upgrade-assessment.md`.
- **Stock libexec images**: both are universal `x86_64` + `arm64` Mach-O images.
  Their digests are recorded with `no prior record`; no stock image digest was
  ever published here, only this project's own builds.
- **The three Intel agents** are now identified. They belong to a separate
  message-bridge system of the owner's: one injects the bridge into Messages at
  login by running the stock CLI's launch path, one is a nightly scheduled job,
  and one is a keep-alive watcher whose child is the long-lived imsg process
  seen in Finding 2. Their plists were read so that stopping them can be offered
  with an exact, reversible restore; the code they run was not read.

Two consequences worth stating plainly:

- Messages.app on the Intel host **already has a bridge helper injected**, by
  that other system, at every login. This project's no-launch reasoning is about
  what *this* code does; it never implied the host had no injected bridge.
- Because the watcher is configured to be kept alive, stopping it must be done
  by removing it from its domain, not by signalling the process, and must be
  followed by confirming the child imsg exited.

## Digest comparison

Pass 1 computed digests only for the two wrapper scripts, since every other
artifact needs Pass 2's per-artifact detail. Both wrapper digests are `no prior
record`, which is expected: no wrapper digest was ever published. Per the plan's
three-valued rule this is recorded and carried forward, not treated as a
divergence.

No previously published digest was contradicted by this pass, because none was
re-computed in it.

## What this pass did not establish

Source-to-binary provenance, a safe launch environment, import/native/helper
closure, absence of runtime writes, Contacts-source equivalence between SSH and
LaunchAgent contexts, real-data parity, C06 performance, or any approval to
execute `imsg`. Additionally unestablished by this pass specifically: the
contents and behaviour of imsg `0.15.3`, whether `0.15.1` is still retained,
Intel's serve state, the location of the M1 build tree, and the digests of every
retained release and runtime.

## Owner decisions required before Phase A can close

1. **imsg 0.15.3 on the M1 host.** Re-pin and re-audit the source at `0.15.3`,
   or treat a retained `0.15.1` as the baseline if it still exists? The stored
   patch and the entire M1 half of the step2 source audit depend on the answer.
   Until it is answered, the M1 host has no audited imsg version.
2. **The Intel watcher and its live imsg child.** Later phases need a stated
   position: measure around it and record it as a confound, or ask the owner to
   quiesce that system for a bounded window. This work will not stop, signal or
   modify it either way.
3. **Intel's missing Tailscale CLI.** Accept "not established", or establish
   serve state another way?
4. **The M1 build tree.** Accept "not found" and plan a rebuild, or investigate
   the unreadable directory?
