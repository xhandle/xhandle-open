# Empty hazard assessments after a completed run

## Report and diagnostic limits

The user reported that `alpamayo1` finished hazard analysis with empty assessment cells. The customer's live run, provider response, and browser storage were not accessed. The exact cause of that run is unconfirmed; a generation failure and a persistence failure must not be conflated.

## Confirmed implementation defect

The standard hazard generator accepted responses containing a matching row ID without assessment content. After retries, missing results could also be converted to fallback rows. The surrounding runner did not reject missing or empty final Summary output before saving and announcing completion. The App restored the prior active run on failure only when it contained user preprocessing, leaving ordinary intermediate output visible after failures.

## Changes

- Accept a generated standard row only when it contains applicability, an applicability rationale, and assessment content for applicable/uncertain rows. Explicit non-applicability with a rationale needs no invented hazard.
- Automatically retry incomplete responses through the existing smaller-batch retry path. Exhausted retries now raise an error instead of silently substituting fallback results.
- Reject missing Summary output, headers-only Summary output, and rows without assessment content before publishing a completed Code-Based Architecture hazard run. Recognize the assessment headers used by the supported analysis methods, including STPA-SEC.
- Restore the captured prior run after failure/cancellation while checking project/run scope, whether or not that run has imported user preprocessing.

These checks establish minimum output presence, not correctness or completeness of the engineering analysis. They do not change the separate storage issues documented in the hazard regression review. No customer data was modified or recovered, and no paid generation request was made.

## Verification

- 12 relevant Jest suites, 108 tests passed, including ID-only responses, automatic retry recovery, exhausted retries, non-applicable rows, missing/blank output, cancellation, preprocessing, and method-specific assessment columns.
- Production build passed with warnings. `git diff --check` passed.
