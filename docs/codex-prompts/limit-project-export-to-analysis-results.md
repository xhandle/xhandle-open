# Implement analysis-results project exports

Implement and validate this task in xhandle-open:

Export only the selected project's architecture decomposition and its generated hazard analysis, software requirements, system requirements, subsystem requirements, and design. Include saved partial results, trace identities, diagram layout, analysis context, and the continuation records needed to resume those analyses. Do not generate missing categories during export.

Use explicit database/store/key allowlists before reading payloads. Exclude full source indexes/snapshots, obsolete architecture history, unrelated projects, reports, remediation, generic review/recovery/workspace databases, credentials, and general settings. Follow only chunk references reachable from included records. Preserve streaming, compression, cancellation, checksum validation, and always-visible progress. Retain compatibility when importing older, broader archives. Explain that source-dependent continuation may require reconnecting the original repository/folder.

Add regression coverage for all six categories, partial continuation, absent categories, excluded payloads never being read, and legacy import compatibility. Run the relevant test suites and isolated Chromium, WebKit, and Electron transfer checks where available. Report actual results and limitations; do not claim a guaranteed file size. Preserve existing work and do not publish a release.
