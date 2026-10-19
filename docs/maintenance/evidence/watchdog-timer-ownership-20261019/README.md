# Watchdog timer ownership fixture

The test for cancelled queued waiters used a real 150ms watchdog, a 25ms sleep
before cancellation and a 220ms observation sleep. CI on contributor PR #1409
failed at `firstP.status`: expected 200, received 499, with total test time
258ms. The production watchdog intentionally covers durable admission and I/O
as well as SDK work. That wall-clock test could expire its healthy holder while
trying to test a different property: clearing the cancelled waiter's timer.

Original evidence: [CI run 39217928847](https://github.com/rynfar/meridian/actions/runs/39217928847/job/117946087274),
head `f722adf513c9d0f60be0cc2e2176b7f91a5526d9`,
[retained excerpt](ci-original-excerpt.log). That failure is not replaced by a
green rerun: the original head's local complete suite passed 6,973 tests with
36 skips, but its CI result remained a merge gate.

The corrected test observes the actual `setTimeout` and `clearTimeout`
functions with pass-through spies. It identifies the two watchdog handles by a
distinct configured delay, waits for the queued request's real acquisition
arrival, and asserts two pending handles before cancellation, one afterward,
and zero after the holder completes. It still requires waiter HTTP 499, holder
HTTP 200, one SDK attempt and no watchdog abort event. It has no elapsed-time
assertion or observation sleep. Production timers, limits and code are unchanged.
The neighboring real watchdog-abort/fencing test remains intact.

The negative control reinstates the historical early return before timer
cleanup in `releaseSessionTurn`. The corrected test fails at the intended
assertion: one pending timer expected, two observed. See the
[mutation recipe](early-return-mutation.patch) and
[red receipt](early-return-mutation-red.log). The production file was restored
byte-for-byte immediately afterward. The [focused corrected-source receipt](focused-final.log)
passes all nine assertions. A clean-source run of the entire concurrency file
passes all 37 tests. One auxiliary whole-file invocation accidentally overlapped
the mutation window and showed the same expected mutation failure; it is
excluded from the corrected-source results.

Reproduce with the package-manager-pinned Bun 1.3.11 (`af24e281`):

```sh
bun test src/__tests__/proxy-concurrency-coordination.test.ts
npm run typecheck
npm run build
npm test
```

Adversarial review checked that both actual timer handles are witnessed before
cancellation, cleanup is asserted before the holder is released, and handles,
queue observers and global spies are cleaned up in `finally` even on failure.
The mutation control demonstrates retained coverage of the actual leak rather
than merely permitting more wall-clock time. This is test infrastructure only;
it changes no client, SDK/model behavior, public interface or dependency.
There is no reason to close the broader intermittent-test trackers #917 or #933.
Final-head full-suite and CI results belong in the PR receipt.
