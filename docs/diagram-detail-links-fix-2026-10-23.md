# Functional diagram detail links

The screenshot's zero Architecture Trace count has a source-supported cause: Functional model rows carry `fromArchitecture`/`toArchitecture` allocations without an `evidence` field. Diagram node generation preferred those allocations over the aggregate record and then read `arch.evidence`, discarding available trace references. Both new and restored nodes were affected.

Node generation now indexes architecture evidence by stable node identity, independently of endpoint allocation. This also avoids merging evidence for distinct nodes with the same label. One evidence index is built, preserving the previous number of full indexing passes.

Details resolve stable node/edge IDs against current diagram rows first. Aggregated links use explicit diagram row refs. Original CSU evidence row numbers are not interpreted as Functional model positions. Missing/stale refs no longer fall back to arbitrary array positions. Hazard and requirement association checks receive the resolved diagram refs, stable trace IDs, and supporting source trace IDs rather than mixed CSU/Functional numeric refs. Original saved evidence is not rewritten.

Validation: 20 tests across diagram detail resolution, architecture indexes, Functional diagram navigation, and hazard diagram navigation passed. Cases cover identical labels with distinct IDs, endpoint allocations without evidence, colliding CSU/Functional numbers, aggregate edges, stale refs, and legacy CSU rows. Production build and lint were also checked; existing component warnings remain. No personal project was opened or modified, and no desktop update was built or published. Requirements and hazards absent from a project cannot be supplied by this fix; their zero counts can be legitimate.
