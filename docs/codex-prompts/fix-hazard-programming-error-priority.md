# Fix programming errors masked by concurrent provider failures

Fix the reproduced provider-first/programming-second regression without weakening evidence preservation or cancellation. Distinguish failures eligible for provider assumption completion from failures that must interrupt. Share that classification between concurrent error selection and the final fallback gate so programming errors cannot trigger fallback even if they carry provider-status metadata. Preserve original errors, causes, partial results, equal-priority ordering, budgets, and ordinary provider fallback behavior.

Test both arrival orders through generation and screening, all supported hazard methods, programming exception categories, and provider-status encodings. Run the full hazard suite and production build. Record results and remaining large-workload limitations. Do not publish, restart the live app, or access personal databases.
