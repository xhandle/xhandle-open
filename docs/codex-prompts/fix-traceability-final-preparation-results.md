# Traceability final preparation fix

Implemented `fix-traceability-final-preparation.md`.

## Changes

Display enrichment and initial table index construction now share incremental preparation. The first pass enriches rows, resolves identities, counts duplicates and builds the reusable row cache; the second pass builds duplicate-aware keys, item lookups, key positions and estimated offsets. Progress covers both passes. Completion no longer constructs the whole row cache in one final step.

EngineeringArtifactTable skips focus scanning when there are no focus targets and consumes prepared keys. VirtualTableBody reuses the prepared keys/positions/initial offsets only when its items exactly match the prepared collection. Filtered collections and measured row layouts retain their existing calculation path. Same-scope small edits continue to prepare immediately to avoid removing active editors.

## Evidence and validation

- 11,859-row matrix fixture with actual matrix columns: rowIdentity calls after the 99% state dropped from 35,629 to 52. Mounted tbody rows remain 14.
- Progress tests now verify enrichment plus index completion, cancellation, same-scope edits and duplicate-aware model parity.
- Assurance and virtual-table suites: 30 suites / 160 tests passed.
- Shared architecture consumers: 2 suites / 45 tests passed.
- Production build passed with existing warnings; no warnings for the changed table/preparation components.
- `git diff --check` passed.

## Limits

The synthetic fixture establishes reduced synchronous identity work after 99%; it does not establish a live Safari time guarantee. React rendering, filtered/measured-layout updates and browser painting still require work. Actual project memory pressure and browser suspension remain unmeasured. No schema, saved data or analysis-generation changes. No commit or push performed.
