# Muted dark appearance accents — 2026-11-21

The initial platform theme left saturated 600/700 blue and purple background utilities untouched. Collaborator prompt bubbles used `bg-indigo-600`; a few dialog buttons also used hardcoded purple fills. This made those surfaces conspicuous against the dark canvas.

## Changes

- Added muted blue and purple action roles, including hover colors, and a separate quieter prompt-bubble surface/text pair. Shared Tailwind backgrounds from 500 through 950 use these dark roles; light appearance retains each original Tailwind color.
- Applied the prompt-bubble pair in docked and full-screen Collaborator. Profile Save, architecture dialog buttons, Design Management artifact actions and traceability form actions use theme tokens in place of hardcoded purple.
- The expanded full-screen check also found a light-mode thread timestamp with only 4.24:1 contrast on its selected row. Its text now uses neutral 600; original light action/bubble fills remain intact.
- Kept the original xHandle logo and authored diagram SVG/node/edge paint. This refinement changes presentation only; analysis, persistence and scrolling behavior are unchanged.

## Regression coverage

- Palette tests enforce muted chroma/luminance, normal-text contrast of at least 4.5:1, distinct hover colors and exact preservation of the original light-mode utility/bubble colors.
- The shared Electron appearance audit now samples visible theme-controlled action fills and rejects saturated blue/purple accents. It deliberately excludes authored diagram/color-picker paint. A forced saturated-action probe proves detection works, alongside the existing unreadable white-panel probe.
- The cookbook diagnostic checks actual computed bubble/text colors in both Collaborator layouts and both appearances, with screenshots and visible-text contrast checks. It also checks dark cookbook action fills through the shared audit.

## Verification

Final production Electron run: `/private/tmp/xhandle-muted-dark-accents-green-20261121/report.json` — **passed (partial selection)**. All five selected categories passed: build, fixtures, theme, collaborator and cookbook. Shared and native source remained stable throughout the run. Shared fingerprint: `225951d03b3dfab0fbd9915ff5626f9c93032654462abb51f8d6ff665aa71164`.

- Appearance: 19 workflow checks, 27 screenshots, 2,657 visible text/field samples and 55 action-fill samples; zero sampled contrast, unexpected bright-panel or saturated-action failures.
- Cookbook: 12 workflow checks, four bubble checks (both layouts in both appearances), three modal appearance audits, six controlled provider responses and no runtime errors. Conversations, attachments and engineering records remain unchanged by prompt preparation.
- The full frontend suite passed **4,546 tests**, with four standard skips, before the final one-line timestamp contrast adjustment. All **171 relevant palette, Collaborator and authored-paint tests** were rerun successfully after that adjustment. Logs: `/private/tmp/xhandle-muted-dark-accents-final-20261121/frontend-results.json` and `/private/tmp/xhandle-muted-theme-unit-final.log`.
- `git diff --check` passed. Representative architecture, docked Collaborator and full-screen Collaborator screenshots were visually reviewed.

The first expanded bubble check sampled the page during a color transition. It now waits for finite CSS transitions, matching the broader appearance diagnostic. The next run exposed the light timestamp contrast issue described above; that was corrected, and the final run passed without relaxing the contrast assertion.

Final appearance evidence: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-workspace-regression-JBGuF2/result.json`. Final bubble/cookbook evidence: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-cookbook-live-U5mkjL/result.json`.

Tests used the production renderer on macOS with disposable profiles and synthetic workspaces. No live paid-model calls, private-data, native runtime changes, commit, push or app update publication were involved. This is selected regression coverage, not a new full 20-category or Linux runtime run.
