Implement the findings in first-diagram-render-review.md.
A new diagram must automatically use the same arrangement routine as the button as soon as
the full hierarchy exists. Persist pending/completed status independently of seed positions.
Do not display the intermediate unarranged graph. Record completion only after layout resolves.
Reopened diagrams must retain saved node/container geometry and viewport; do not rerun
automatic arrangement because of a clean notification. Preserve legacy saved layouts.
Keep explicit Auto arrange available. Verify first-render equivalence and restoration,
including pending state with seeded positions, with regression tests and a real browser.
Do not commit or push.
