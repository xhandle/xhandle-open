# Review hazard table navigation fixes

Audit the fixes for measurement-driven target loss and scroll resets. Keep application code unchanged. Verify stable row identity, measured navigation completion, removal/collapse fallback, scope changes, quick search, and worker lifecycle. Exercise React StrictMode, which is enabled in the application, as well as normal rendering. Run the permanent suite and focused probes; distinguish confirmed regressions from limitations and document exact source locations. Do not claim live Safari performance without measuring it.
