# Large CSU navigation performance

## Finding and change

The CSU function renderer mounted 32 React Flow Handles per function. Each Handle installs two store subscriptions, evaluated on viewport updates. Off-screen culling does not help a fitted overview where all functions are visible. Existing motion styling and edge-label optimizations did not remove these idle subscribers.

Large detailed architecture canvases now mount only handles referenced by the displayed graph while idle. Hovering, focusing or selecting a function restores its complete port set. Connected endpoints remain mounted, including parallel edges and self-loops. Nodes with unspecified handles keep their defaults. React Flow remeasures ports only when the port set changes; initial measurement remains its responsibility. Smaller diagrams retain their full ports.

No analysis rows, grouping, positions, routing settings, source data or persistence schemas change. Existing viewport culling and manual-route handling remain in place.

## Verification

- Four targeted Jest suites / nine tests passed, including connected-port preservation, fallback behavior, existing CSU routing/ordering and the Functional inspector.
- Production build passed with existing warnings; ESLint reported zero errors and 11 existing warnings. Diff whitespace check passed.
- `scripts/diagnostics/verify-csu-navigation.cjs` uses a fresh Chromium context and 800 synthetic relationships / 801 functions. It checks complete hover ports, unchanged route geometry within subpixel measurement tolerance, two-axis pan, pinch zoom and decoration restoration. No customer data or model calls are used.
- Same fixture, development build: baseline (`BASELINE=1`, pruning disabled in the browser-served bundle) mounted 26,048 handles at fit; optimized mounted 2,016, about 92% fewer. The pan sample took 2,905 ms baseline versus 1,713 ms optimized; 95th-percentile animation-frame interval fell from 50 ms to 16.8 ms. These are local measurements, not a cross-device performance guarantee.
- Test browser server was started separately on port 3001 because port 3000 was unavailable. Safari and customer-scale datasets were not tested. Extremely large graphs still incur visibility scans and browser rendering costs.
