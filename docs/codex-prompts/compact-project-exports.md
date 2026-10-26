# Compact project exports without losing resumability

Implement compact project exports in the shared xHandle application for browser and desktop use.

Requirements:
- Export architecture and only selected generated hazard/requirement/design categories. Architecture is required; default to including all available analysis categories. Keep selection and progress accessible.
- Preserve partial results, stable identities, traceability, user edits and the checkpoints needed to continue selected analyses after import. Do not delete source data or silently discard required evidence.
- Reduce transport overhead: avoid repeatedly encoding already-tokenized chunks, use ordinary JSON for ordinary values, encode binary efficiently, and preserve non-JSON structured types with unambiguous escaping.
- Retain bounded streaming, compression, cancellation, integrity validation, atomic import and support for older archives. Clearly version the new encoding; fail safely on unsupported or malformed data.
- Compare sizes using synthetic repetitive evidence and the supplied legacy Alpamayo export, without modifying the supplied file or user databases. Record raw and gzip sizes, scope differences, and limitations. Do not promise a fixed maximum size.
- Test partial-analysis roundtrips, category exclusions, structured values, malformed archives, and browser/Electron runtime behavior. Do not publish a desktop release as part of implementation.
