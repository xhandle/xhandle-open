# Review manual functional diagramming

Investigate why creating a subsystem and adding or moving function nodes into it can create additional subsystems or rearrange functions. Run this review against the current xHandle implementation without changing application behavior.

Treat the user's desired interaction contract as direct manipulation: manually created containers retain their identity; adding, connecting, renaming, grouping, or moving a function must not silently generate duplicate containers or rearrange unrelated elements. Membership changes must preserve intended positions and synchronize the functional decomposition. Explicit Auto arrange remains available; imported/generated diagrams retain their initial arrangement behavior. Do not assume full parity with every draw.io or Lucidchart feature.

Trace toolbar creation, drag/drop, context-menu membership, connection creation, subsystem/system reconciliation, automatic layout triggers, resizing, persistence, and undo/redo. Identify competing sources of truth and effects that can override manual intent. Include blank diagrams and mixed imported/manual diagrams, disconnected functions, system-nested subsystems, and the transition from a manual node to a table-backed function.

Use isolated synthetic browser projects and existing unit tests to reproduce important findings. Record exact steps, before/after node identity, parent, and position data; distinguish browser-confirmed defects from source-level risks. Never use or mutate the user's project data. Save a prioritized review with source references, a proposed implementation plan, and regression acceptance criteria. Do not implement fixes, commit, or push as part of this review.
