# Review code architecture link navigation

Review the current working tree to determine why code architecture table links to functions, control actions, and other tabs sometimes require a second click or focus the wrong diagram item on the first click. Execute this review without changing application behavior.

Trace functional table, hazard analysis, remediation, requirements, design, and traceability link paths through target construction, tab/view switching, file filters, abstraction selection, graph construction, layout, React Flow measurement, selection, viewport fitting, and completion acknowledgement. Check stable identities versus names/row indices, asynchronous loading, stale timers, repeated requests, hidden/filtered/collapsed targets, and effect dependencies. Distinguish table navigation from diagram navigation.

Use isolated synthetic browser data and focused deterministic probes; never modify the user's projects or trigger paid analysis. Run relevant existing tests. Save confirmed findings with source locations, evidence, severity, impact, and recommended fixes in docs/investigations/code-architecture-link-navigation-review.md. Separate reproduced defects from code-confirmed risks and unverified hypotheses. Explain why a second click can work and identify regression-test gaps. Do not implement fixes, commit, or push in this review.
