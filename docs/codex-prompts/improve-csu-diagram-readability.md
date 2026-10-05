# Improve CSU diagram readability

Compare Code-Based Architecture's CSU rendering with Projects functional diagrams using the supplied screenshots. Improve function and connection readability without altering extracted calls or downstream analysis data.

Inspect the actual layout and rendering paths first. Reuse Projects' function appearance and orthogonal edge behavior where appropriate. Avoid compounded fills from four nested architecture containers. Keep hierarchy labels, comments, trace highlighting, and color controls available.

Arrange related functions closer within each CSU using the existing grid; preserve function dimensions, the requested 3× function gaps, and existing CSC/container spacing. Keep stable identities, membership, rows, edges, and traceability. Respect restored/manual positions. Do not hide or remove relationships to make the picture appear cleaner. Keep compact abstraction views working.

Validate local edge-distance improvement, deterministic ordering, membership preservation, unchanged spacing, saved-layout restoration, routing controls, style toggles, bundles, and read-only behavior. Use isolated browser fixtures; do not modify real projects or call AI services. Run relevant tests and build. Document limitations, particularly that local ordering does not provide global obstacle avoidance or eliminate every crossing. Do not commit or push unless requested.
