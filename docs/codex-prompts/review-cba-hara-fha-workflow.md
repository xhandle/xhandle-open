# Review Code-Based Architecture HARA and FHA workflow parity

Perform a read-first engineering audit, without changing production code, comparing HARA and FHA with Code-Based Architecture STPA. Account for legitimate method differences: do not impose STPA guide phrases or command/control screening on other methods.

Trace UI dispatch, Functional versus detailed input selection, eligibility, scenario/mode binding, source evidence, generation validation/retries/cancellation/checkpoints, partial results, persistence/reload, regeneration, imported decisions, table/CSV navigation, and software-requirements sourcing and provenance. Follow actual generators rather than relying on outer-runner mocks. Determine whether missing/failed assessments can be published or used as requirements. Check how HARA Safety Goals and FHA Software Safety Requirements, classifications and verification reach downstream artifacts and how multiple methods are selected.

Run relevant existing tests plus bounded synthetic integration probes with mocked model responses. No paid model calls or customer database mutations. Report reproducible defects with code locations and severity, what already works, limitations, and prioritized fixes. Do not claim standards compliance or real-world safety validation from these software checks. Write a review report; implementation requires a separate request.
