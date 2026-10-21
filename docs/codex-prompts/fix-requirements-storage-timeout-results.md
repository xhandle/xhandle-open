# Requirements storage recovery fix

Executed the prompt in fix-requirements-storage-timeout.md.

- Caught parent-source rejections in System Requirements, Subsystem Requirements and Design; storage failures have their own retryable notice rather than escaping as unhandled promises.
- Retry loading and Refresh Sources re-read saved rows, parent sources and linked collections without invoking generation. Same-scope loaded rows survive failures; cancellation and revision checks protect against stale results and edits being overwritten.
- Concurrent same-key reads share an in-flight promise scoped to the current write version. Settled reads are evicted, and newer writes bypass older requests.
- Database open timeouts retry up to three attempts (five seconds each). Timeout wording no longer assumes another tab blocked the database. Confirmed blocked upgrades retain their separate message. Late successful connections are closed.
- Existing schema, stored record formats, generation and persistence fallback policies remain unchanged.

Validation: 26 suites / 143 tests passed, including six new focused recovery tests and the existing storage/schema/write-race suites. git diff --check passed. Production build passed with lint/Browserslist/bundle-size warnings.

Limits: the customer's exact Safari storage stall was not reproduced. These fixes address demonstrated error-handling and duplicate-read defects; they do not guarantee browser storage always responds.
