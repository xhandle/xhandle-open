# Hidden hazard cache implementation review

## Outcome

No new actionable regression found in the reviewed fix. The previously identified hidden-tab cache retention defect is addressed: the workspace invalidates caches using shared preparation dependencies whether or not the panel is mounted. Retired caches are cleared and cannot receive late preparation results. Unchanged inputs preserve reuse.

Inspected App integration, cache ownership and dependency definitions, loader preparation/publication, cancellation cleanup and freshness calculation inputs. Checked that the App and loader receive the same summary, architecture, operational-context, selection and organization inputs. This change does not alter saved data or analysis generation behavior.

## Verification executed

- Existing 23-suite regression set: 190 tests passed, including archive, storage, restoration, diagrams and backup checks (`/tmp/cache-review-full.log`).
- Added two further lifecycle regressions: in-flight replacement under React StrictMode and unrelated metadata updates while hidden. Reran the affected suite: all 17 tests passed (`/tmp/cache-review-extra.log`). This covers 192 distinct tests across the two runs; the entire suite was not repeated after these test-only additions.
- Real table component test passed for 26,278 rows through five hide/reentry cycles with fewer than 100 rendered table body rows. This is jsdom component coverage.
- Isolated Chromium diagnostic passed 100 reentries for 14,483 synthetic rows with 101 metadata checks and no additional root payload reads after initial load. Peak sampled JS heap was 28.84 MiB, renderer peak working set 163,104 KiB (`/tmp/cache-review-stress.log`).
- `git diff --check` passed.

## Limits

The Chromium diagnostic replaces the final panel renderer with a no-op; the separate real-table test runs in jsdom. Neither establishes memory behavior for the complete live application with all diagrams, simultaneous analysis, real evidence sizes, or the user's original crashing workspace. Safari was not exercised. No new production build was needed for this review's test/documentation-only changes; the preceding fix's production build passed with warnings.

The specific cache regression is verified fixed within these checks. The original Chrome error-code-5 crash remains unconfirmed end-to-end, and absence of further findings is not a guarantee of no bugs. This review changed only tests and documentation; it did not commit, publish, or touch saved user data.
