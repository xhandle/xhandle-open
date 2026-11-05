# Collaborator live progress

The reported VulnerableApp prompt stayed on the saved-information message while a large code-architecture index pass ran. The index worker previously reported only whole-stage boundaries; the context builder did not forward those events to Collaborator. Callers joining an existing indexing job also did not receive that job's progress.

Changes:

- The worker emits cumulative distinct artifact counts after completed write batches, throttled to at most two batch updates per second. No record text is included. Stage transitions remain immediate.
- Shared indexing callers subscribe to current progress, receive the latest stage on joining, and unsubscribe on completion/cancellation.
- Context retrieval forwards storage wait, preparation, reconciliation, projection, search, and relationship stages to the existing Working card.
- Progress history is capped at twelve entries. Retrieval updates replace their current entry. Cancelled prompts ignore further updates.
- A small isolated component displays elapsed time once per second and clears its timer on unmount; conversation/workspace components do not render for each clock tick.
- Model waiting and response streaming use transport events. The UI does not present invented internal reasoning, guessed completion percentages, or elapsed time as proof that the provider is actively reasoning.

Validation: 266 tests across 19 suites passed, including real IndexedDB migration batch progress, shared worker progress/cancellation, and timer isolation/cleanup. The optimized production build passed with existing lint warnings. Thirteen native scenarios passed in each of Electron and Chrome (26 total), with no uncaught runtime exceptions. These scenarios verify truthful storage-wait status and elapsed time, general questions bypassing storage, named-project evidence, complete counts, and unchanged model settings. External traffic was blocked; the provider was a local mock. The updated isolated Electron preview is 0.2.14-preview.20261105.3. No desktop release was published.

Limitation: This change addresses visibility during first-time large-project preparation. It does not establish that the remaining multi-minute CBA indexing bottleneck is eliminated. The earlier scoped-retrieval investigation documents that limitation. No new external AI requests or transfers of customer project bodies are required for this verification.
