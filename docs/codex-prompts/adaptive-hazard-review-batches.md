# Increase and adapt compact hazard review batches

Increase semantic-review limits from 12 rows/30,000 characters to a trial ceiling
of 24 rows/60,000 characters. Leave generation at 32 rows and three shared provider
requests. Share adaptive limits within a run: reduce on truncation, malformed or
missing verdicts and cautiously grow after successful full batches. Keep complete
source evidence and preserve valid verdicts when only some IDs are missing.
Maintain semantic validation, bounded retries, checkpointing and cancellation.
Measure generation/review request counts and durations plus wall time per newly
accepted assessment without logging prompts or source content. Add regression
coverage for larger batches, shrink/recovery/growth, concurrent outcomes, missing
verdicts, oversized individual rows and metrics. Run compatibility tests and build;
distinguish mocked verification from live-provider speed measurements.
