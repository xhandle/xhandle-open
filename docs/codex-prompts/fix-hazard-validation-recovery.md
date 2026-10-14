# Recover hazard validation failures

Trace the compact STPA/HARA/FHA validator, correction retries, checkpoints,
publication and App error handling. Surface exact row/action/phrase/reasons and
retain parsing/truncation errors. Do not assume the failed validation rule without
the original findings. Keep bounded retries and governed human decisions.

Allow independent batches to complete after a row exhausts validation; stop for
cancellation/systemic failures. Save and show validated partial work as incomplete,
separate from an existing completed run. Continue must reuse checkpoints and retry
unresolved work. Persist failure details across reload. Preserve final-save recovery
and expose export/retry-save. Do not allow incomplete runs to feed software
requirements. Test these paths and run the production build. Do not interrupt a
customer run, delete saved data, commit or push.
