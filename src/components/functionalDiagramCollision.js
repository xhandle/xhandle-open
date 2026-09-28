// Shared rectangle clearance used by subsystem and system placement.
export const GROUP_COLLISION_CLEARANCE = 80;

export function diagramRectsOverlap(a = {}, b = {}, padding = 0) {
  const ax = Number(a.x) || 0;
  const ay = Number(a.y) || 0;
  const aw = Number(a.width) || 0;
  const ah = Number(a.height) || 0;
  const bx = Number(b.x) || 0;
  const by = Number(b.y) || 0;
  const bw = Number(b.width) || 0;
  const bh = Number(b.height) || 0;
  return !(
    ax + aw + padding < bx ||
    bx + bw + padding < ax ||
    ay + ah + padding < by ||
    by + bh + padding < ay
  );
}

