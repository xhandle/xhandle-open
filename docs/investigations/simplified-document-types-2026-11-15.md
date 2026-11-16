# Simplified document types

Creation now offers ConOps, Architecture, System Requirements Specification, Software Requirements Specification, Hardware Requirements Specification, and Traceability Matrix. The matrix retains its existing project-only workflow after source artifacts exist; the standalone and project drafting dialogs offer the other five choices in the requested order. The project dialog retains ConOps and system requirements as its default selection.

The canonical `conops` and `system-spec` identifiers, template versions and section IDs are unchanged. Their displayed type names and new default titles use the requested wording. Existing document titles, content, revisions, source citations and relationships are retained. Retired templates remain in the read/generation registry for existing artifacts and saved projects, but are excluded from the creation catalog. The creation dialogs no longer run the retired safety-document source checks.

Validation: 162 tests across five suites passed, including exact creation choices, default titles, select-all, multiple architectures, standalone and project generation, legacy artifact workflows, and software/hardware requirements. ESLint and whitespace checks passed.

Production compilation passed with the larger local Node build allocation; the initial attempt exhausted the default Node heap. Source maps match all three updated renderer modules and their worker copies. Final isolated Chrome and Electron runs each passed all 25 scenarios with zero captured errors or paid AI requests. The new live checks inspect the exact creation choices, updated default titles and project selection controls; existing checks cover saved legacy artifacts, matrix capture, historical chains, navigation, diagram clearance and deletion. The idle isolated Electron preview was refreshed while retaining its workspace.

Live evidence: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-tHTres/result.json` (Chrome) and `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-traceability-live-hziGIt/result.json` (Electron). No commit, push or release is included.
