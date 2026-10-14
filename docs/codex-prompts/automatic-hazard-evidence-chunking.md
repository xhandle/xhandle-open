# Automatic oversized hazard evidence processing

Read the active STPA/HARA/FHA results-first pipeline. Preserve the normal fast path, governed applicability, method-specific rating logic, structural validation, and downstream requirements wiring.

For an oversized individual request (or provider context-limit rejection), automatically extract evidence in bounded chunks. Prefer JSON object/function boundaries and newline boundaries for long strings. Keep every original fragment, with JSON pointer/offset references. Extract facts, constraints, safeguards, conflicts, and unknowns, without making hazard or applicability decisions. Require complete fragment coverage and valid citations. Preserve explicit uncertainty and organization criteria. Merge summaries hierarchically only when necessary, retaining source lineage. Do not claim a summary is lossless or fully verified.

Bound concurrency and retries. Split chunks again when the provider rejects their size or truncates their response. Checkpoint extraction and reduction separately from analysis; resume valid completed chunks and retain in-memory work if persistence is unavailable. Respect Stop. Keep exact IDs, phrases and governed decisions in final requests. Reuse preparation across stages and identical inputs. Only oversized inputs incur extra calls.

Exercise all three methods, normal inputs, provider rejection, recursive splitting, malformed coverage/citations, unicode, cancellation, checkpoint reuse, reduction lineage, and partial-result preservation. Report limitations honestly and do not run paid customer analyses without authorization.
