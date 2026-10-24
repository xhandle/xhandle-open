# Fix concurrent hazard failure priority

Fix the review finding where an earlier budget error masks a later unavailable-prepared-evidence error. Inspect all parallel failure collectors in evidence preparation, applicability screening and generation so the chosen error remains intact through the pipeline. Give cancellation first priority, then required-evidence storage failures, then other non-deferrable failures, then deferrable row/budget errors. Preserve the original error object and cause, use stable first-error selection for equal priorities, and do not reset request budgets or weaken validation.

Convert the defect reproduction into a regression and cover both arrival orders and cancellation. Run the complete hazard suite and production build, record results and remaining architecture limitations. Do not publish, restart the live app, or access personal workspaces.
