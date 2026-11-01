# Trackpad navigation follow-up — 2026-10-31

The user confirmed both a pause at pinch start and choppiness during the gesture. The intended controls are unchanged: two-finger scrolling pans in both axes; pinch/unpinch zoom around the cursor; the +/− controls remain available and keep their behavior.

**Gesture correctness passes; the remaining performance issue is not resolved.** This follow-up adds reusable first-input tracing and direct two-finger pan coverage. It makes no additional application-renderer change. Eight isolated prototypes did not establish a reliable improvement in both startup and sustained responsiveness; none was adopted.

## Verified behavior

The existing shared CBA renderer enables free-axis panOnScroll, disables ordinary-wheel zoomOnScroll, and retains React Flow's enabled zoomOnPinch default. Chromium delivers trackpad pinch as ctrl-wheel and ordinary two-finger scrolling as wheel without that modifier. The tests exercise those event paths directly, separately from middle-button dragging.

All four runtime/view cases pass at overview and close zoom: Chrome Functional, Chrome CSU, Electron Functional and Electron CSU. Each uses 1,500 functions and 3,000 relationships. Checks include:

- Two-finger pan in both axes, reverse direction, unchanged zoom, unchanged page scroll and restoration after input stops. A forward burst translates by the expected −180/−120 pixels; its reverse returns to the original camera.
- Pinch/unpinch direction, cursor anchoring and matched 1.2× +/− inputs.
- Rapid 120-input pinch bursts, preserved total wheel delta and recovery of the original camera after balanced reversal.
- No page runtime errors.

These are trusted browser events driven by CDP in disposable profiles. They validate event semantics and renderer behavior, not physical-trackpad latency or the customer's M4 project.

## Untraced measurements

Milliseconds. First changed-frame values are medians of both directions over two repetitions. Pinch-burst p95 measures intervals between frames with changed camera transforms; pan p95 measures active rAF intervals during the two-phase pan test. Do not equate these quantities with hardware presentation FPS.

| Runtime/view and scale | First button frame | First pinch frame | Rapid pinch changed-frame p95 | Two-finger pan rAF p95 |
|---|---:|---:|---:|---:|
| chrome-functional / overview | 26.3 | 151.0 | 66.8 | 33.4 |
| chrome-functional / close | 23.5 | 133.8 | 34.3 | 33.4 |
| chrome-csu / overview | 32.6 | 155.3 | 50.1 | 33.4 |
| chrome-csu / close | 27.3 | 147.2 | 50.0 | 33.8 |
| electron-functional / overview | 32.3 | 340.7 | 33.5 | 33.5 |
| electron-functional / close | 38.9 | 141.2 | 33.4 | 33.3 |
| electron-csu / overview | 32.3 | 163.9 | 50.1 | 33.4 |
| electron-csu / close | 27.3 | 161.8 | 34.4 | 33.8 |

The controls work correctly, but these results do not meet a claim of uniformly smooth startup and continuous navigation. The [earlier implementation report](diagram-overview-performance-fix-2026-10-31.md) remains the record of the accepted application improvements.

## First-pinch attribution

The camera transform commits before the largest pause. Traces identify a substantial main-thread style recalculation when the large scene switches into motion presentation. The trace also retains paint, layer assignment, hit-testing and JavaScript events. Instrumentation increases cost; these figures explain where work occurs and must not replace untraced latency measurements.

| Runtime/view and scale | Camera commit ms | Largest UpdateLayoutTree ms | First changed-frame ms, traced |
|---|---:|---:|---:|
| chrome-functional / overview | 15.5 | 220.8 | 259.2 |
| chrome-functional / close | 14.1 | 167.3 | 195.0 |
| chrome-csu / overview | 17.1 | 229.6 | 273.7 |
| chrome-csu / close | 16.9 | 196.8 | 239.5 |
| electron-functional / overview | 13.3 | 225.6 | 258.6 |
| electron-functional / close | 13.7 | 180.3 | 210.1 |
| electron-csu / overview | 16.2 | 205.6 | 241.0 |
| electron-csu / close | 17.9 | 201.2 | 242.9 |

The original exploratory Chrome trace sampled a rAF timestamp predating the input. The reusable diagnostic now filters those callbacks out; the table uses only corrected confirmed runs. This was a measurement bug, not an application bug.

## Rejected experiments

All experiments use disposable Chrome pages and the same application bundle. Values below are exploratory medians/p95 for overview / close, not accepted rendering changes.

| Prototype | First pinch frame ms | Rapid pinch changed-frame p95 ms |
|---|---:|---:|
| opacity-edges | 171.6 / 123.2 | 67.3 / 50.1 |
| opacity-labels | 324.2 / 298.4 | 216.6 / 233.3 |
| batch | 174.7 / 132.5 | 50.0 / 35.3 |
| effect-rules | 90.2 / 67.9 | 366.8 / 83.3 |
| contained-labels | 157.3 / 133.4 | 33.5 / 50.0 |
| idle-cache | 157.4 / 124.4 | 64.9 / 34.8 |
| selectors | 155.8 / 116.3 | 35.0 / 52.0 |
| filter-rules | 221.5 / 169.8 | 82.3 / 100.0 |

- Native-edge or label opacity kept expensive content participating in rendering and worsened sustained behavior.
- Frame-scheduled input preserved deltas but did not reliably improve responsiveness.
- Removing both filter and shadow motion rules shortened some startup measurements but introduced roughly half-second frames during continuous overview zoom.
- Keeping shadows suppressed while removing only filter/animation rules did not improve the result.
- Label subtree containment, a narrower group-box CSS selector and preparing the cached edge paint before input did not establish a reliable fix for both symptoms.

The idle-edge-cache prototype was an attribution experiment, not a finished rendering design; it also overlapped subsequent process startup near its last samples. No visual-equivalence or production acceptance claim is made for it. The earlier pre-rasterized PNG experiment is documented in the prior report and was likewise not adopted.

## Changes and remaining work

New reusable diagnostics: diagram-pinch-trace.cjs and diagram-trackpad-pan.cjs, wired into the existing overview harness with --pinchTrace 1 and --trackpadPan 1. The implementation prompt now explicitly requires both startup and sustained performance, plus the intended two-finger controls. No application files, customer data, installed desktop app, dependencies or release configuration changed during this follow-up.

The remaining implementation problem is reducing the large-scene presentation work without retaining expensive hidden layers, changing visuals, losing hit targets or regressing sustained zoom. A further renderer change needs evidence for both latency measures and the existing editing/export/visual regressions. Enabling gestures, averaging away long frames or shifting the pause into a later frame is not a fix.

Build manifest SHA-256: 447c3ae27601632b9f776589da3071e093f3c0c4ffa1349b9caddfe2cfb17559. Source hashes match the prior accepted application. Full compact measurements, provenance and limitations are in [the measurement artifact](../investigations/diagram-trackpad-followup-2026-10-31.json). Raw logs, profiles and traces are under /private/tmp/xhandle-pinch-followup-20261031. No commit, push or desktop update was performed.
