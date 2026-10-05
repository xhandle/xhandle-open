# Functional decomposition call scope

Implemented `../codex-prompts/scope-functional-decomposition-to-behavioral-calls.md`.

The full Python syntax inventory and the published functional decomposition now have separate purposes. The inventory retains all source evidence; the table and diagram publish production function/method call relationships. Source-supported imported and receiver calls remain included even when exact runtime dispatch is unknown. Meaningful initialization, constructors, computation, validation and I/O remain included. Hazard eligibility is a separate decision and is not used to prune the decomposition.

Class membership and inheritance remain audit/hierarchy evidence. Test/example/fixture/mock/benchmark call sites are outside the production view. A small explicit list of unshadowed Python iteration/introspection helpers is excluded, as is built-in exception construction directly in a raise statement. User-defined, shadowed and ambiguous bindings are preserved. `super().__init__()` remains a method call while its inner `super()` helper does not become a separate row. An exception factory used anywhere outside raise in the same relationship remains represented.

Unmatched model proposals from supported Python files are retained for review in the run ledger and workbook, rather than being published as established calls. Other-language extraction keeps its existing behavior and explicitly lacks this new Python syntax/scope guarantee; this change does not silently empty JavaScript/C++ projects or claim to implement new parsers.

The analysis version is `source-equivalence-v4-call-scope`. Apply the scope by rerunning analysis after reloading the updated app. New runs invalidate older checkpoints. Retained calls retain canonical evidence/IDs, trace IDs, row references, node/edge IDs, edited descriptions and analyst overrides. Removed existing rows remain historical. The table hides history by default, offers Show history, and reveals an explicitly linked historical row. Workbook Architecture contains current rows, with historical rows in Architecture History. Source Inventory and Review Proposals sheets expose inventory dispositions and excluded proposals. Existing downstream records are not deleted, and historical relationships remain excluded from new hazard generation.

## Validation

- 204 tests passed in 26 suites, including source/parser, call scope, negative shadowing cases, historical navigation/index preservation, source-audit reinsertion prevention, coverage exports, and downstream hazard/remediation/requirements/design/traceability compatibility.
- `code-source-convergence-v4-check.cjs` exercised both adapters and a repeated GitHub run against all 22 local Alpamayo Python files. All AI/GitHub requests were intercepted; no source was sent to an external service and no paid AI was used.
- Full inventory: all 909 canonical identities still match the prior real workbook.
- Published calls: 590, identical across local/GitHub; comparison fingerprints match.
- Inventory dispositions: 104 hierarchy relationships, 148 nonproduction calls, 52 language helpers, 15 raised-exception constructions, and 590 published calls.
- The browser migration test seeded the 319 previously published but now excluded relationships, reran analysis, and confirmed their retention as historical records. Current call trace IDs were preserved.
- Current-call hazard eligibility: 406 Include and 184 Needs Review. These are source-screening decisions, not findings that hazards exist.
- Empty-file placeholder rejection, unique imported-proposal reconciliation and portable coverage counts passed.

The production build and whitespace check passed. Build output contains existing lint warnings.

This is deterministic scope selection, not a claim that every remaining call is a high-level system function or hazard-relevant. Calls within an implementation may still be detailed, and the syntax inventory does not prove runtime dispatch or a complete semantic call graph. No target row count or AI-based suppression was used. The browser checks used controlled model responses rather than new live-provider analysis.
