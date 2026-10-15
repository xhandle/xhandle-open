# Architecture render out-of-memory audit

## Confirmed crash path
The supplied Safari stack identifies native JSON.stringify in computeArchitectureSnapshotHash, called by buildCodeArchitectureHazardInput -> buildCodeArchitectureHazardCsvDraft -> the root App useMemo. Current code matches this stack. It serializes every architecture row's full codeEvidence and sourceEvidence together into one string after stableValue recursively rebuilds their object/array structure. This is a browser allocation failure, not a provider request or final hazard-save failure. The exact failing payload size and available browser memory are unknown.

## Contributing factors
- App.js:14650 eagerly constructs the draft whenever no hazard run exists, with no visible-tab guard. It runs even while viewing the architecture. Memo dependencies can rerun it after row, context, method, or metadata changes.
- App.js:14659 separately hashes the architecture again for the CSV workspace key. Hashing is not cached across these callers.
- codeArchitectureHazardUtils.js:226 stableValue recursively rebuilds objects and arrays without memoizing shared references. :237 includes complete evidence; :254 creates the single JSON string.
- buildCodeArchitectureHazardInput expands eligible relationships across guide phrases and contexts and builds the functional-decomposition sheet before calculating this hash (:695–745). CSV draft creation then builds additional summary structures. These contribute to peak allocation; the observed throw itself is the hash stringify.
- generateFunctionalDecompositionFromGitHub.js:2860–2895 caches file-evidence objects across rows but attaches file function metadata repeatedly. Selected function snippets appear under both codeEvidence.sourceFunctions and sourceEvidence.functions. Serialization repeats shared content; shared in-memory references do not deduplicate JSON. No evidence was found establishing runaway evidence growth or a circular-reference defect in this incident.
- App's root render performs the computation. src/index.js wraps App with StrictMode and LicenseProvider, with no root error boundary; the report viewer's local boundary does not enclose this work. An uncaught render error can unmount the UI, explaining the blank screen. StrictMode/development hot updates may amplify reruns but are not established as the cause.

## Bounded validation
A temporary test used 100 rows sharing one 8,192-character evidence payload in both evidence fields. The actual fingerprint function produced a 1,691,093-character JSON string. The test verified the canonicalized evidence objects were rebuilt separately across rows. No memory exhaustion was attempted. 43 tests passed across utility, CSV, and temporary probe suites; temporary probe removed. This proves amplification, not the customer's actual peak heap size.

## Persistence and recovery
The normal generator awaits prepareArchitecturePublication and recoverArchitecturePublication before setTableData (:3561–3577). Recovery awaits the IndexedDB publication transaction and marks storageSaved before returning. Therefore the completed architecture is likely already published when this render path fails. This is a code-order inference, not a read of the user's database. Saved data can trigger the same crash when rehydrated. Do not clear site storage or regenerate as a recovery step. After correcting render allocations, load the same project and verify its saved architecture/metadata; use the existing publication recovery path if a ready checkpoint remains. Browser-native export/inspection of the architecture IndexedDB records can establish actual presence without rerunning generation.

## History
- f300c9ff (July 28): full evidence canonicalization/stringification in snapshot hash.
- 6464bf44 (September 26): code architecture CSV draft workflows.
- a7385e3f (October 11): current no-hazard-run draft guard and separate CSV workspace fingerprint.
- These allocations predate the pending final hazard-save changes. Nothing in this stack establishes that those save changes caused the crash.

## Smallest safe fix plan
1. Incrementally feed the exact existing stable JSON character sequence into the existing 32-bit hash, without constructing the full normalized tree/string. Preserve null normalization, sorted object keys, JSON escaping, UTF-16 hashing, and array order; verify equality with legacy output. Stream large string escaping too, so one large evidence field does not require another giant string.
2. Reuse fingerprints only for immutable row snapshots (or with explicit revision invalidation). Do not omit evidence/change detection fields.
3. Build draft rows/sheets lazily for the actual hazard/export/import workflow; avoid triggering the full hazard expansion in root rendering on architecture publication. Lazy tab gating alone will not fix the hash allocation when the user eventually opens hazards.
4. Add an outer error boundary with recovery UI as secondary containment; do not rely on catching genuine process-level OOM.
5. Regression tests: legacy hash equivalence for nested/null/Unicode/escaping/key ordering; evidence edits invalidate hashes; shared large evidence does not require whole-array stringify; architecture view does not build draft; import/export still works; saved publication reload is isolated; root render failure has a fallback.

No production code or user data changed. No live Safari heap profile performed.
