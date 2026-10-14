# Functional diagram modal links

The detailed diagram received hazardSummary, assuranceArtifacts and both navigation callbacks, but the FunctionalArchitectureDiagram branch did not. Its shared node/edge modal therefore saw the default empty collections, regardless of generated results.

Forwarded all four props through the Functional wrapper into its shared canvas. Added durable requirement loading in App via useDiagramAssuranceArtifacts: async loads of all four artifact kinds, scoped change-event refresh, and protection against stale responses after project/repository changes. Previously App used only loadArtifactRows, a synchronous memory/localStorage lookup which cannot retrieve IndexedDB-only records after reload.

No generation, persisted artifact schemas or link-matching rules changed. Empty categories still legitimately show zero when no linked artifacts exist.

Validation: 46 tests passed in three suites. The integration regression passes hazard and requirement data through the real decomposition/Functional wrappers and verifies canvas navigation callbacks. Hook tests cover async storage loading, scoped updates and stale project responses. No live browser session was exercised.
