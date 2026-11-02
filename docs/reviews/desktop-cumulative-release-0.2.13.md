# Desktop cumulative release 0.2.13

The desktop release advances the shared application from `614802c` (0.2.12) to the published commit containing this report. It includes the intervening storage, large-export checksum, continuous table scrolling, memory, diagram rendering and gesture improvements, plus the diagram navigator, collapsed categories, label navigation, 15% minimum diagram zoom and primary hazard loading indicator.

## Shared validation

- Full frontend suite: 335 suites passed, one failed, two skipped; 2,933 tests passed, eight failed, four skipped.
- All eight failures are in `hazardEvalRunner.test.js`, reporting missing FD-1/FD-2 fixture assessments. The runner, fixtures and standard hazard generation implementation are unchanged from `614802c`. An independent run in the prior desktop source checkout reproduced the same eight failures (11 tests passed). The existing parity audit also records these failures. They remain unresolved; assertions were not weakened.
- Release-focused regressions: seven suites and 162 tests passed, covering quick search, navigation, both diagram implementations, trackpad zoom and saved hazard loading.
- The production renderer build passed with existing lint and bundle-size warnings before release preparation. Desktop packaging performs another build from the final published source commit.

Native signing, notarization, packaged checks and public update verification are recorded separately in the private desktop repository and its release receipt.
