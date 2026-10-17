# Preserve reused settings and protect recoverable connections

Fix both findings from the duplicate-connection review. Selecting an existing local connection from a blank setup form must populate its saved context, context attachments and file-type selection; reconnecting the currently edited connection must preserve deliberate draft edits, including empty values. Verification must preserve repository identity and existing metadata.

Before removing an inactive connection with no analysis date, check persisted rows, metadata, checkpoints, pending publication and queued writes, including legacy repository aliases. Fail closed on storage errors. Do not hydrate large architecture data merely to detect its existence and do not delete analysis records. Recheck current activity and connection state after asynchronous inspection. Add regression tests and run related suites; no paid API requests.
