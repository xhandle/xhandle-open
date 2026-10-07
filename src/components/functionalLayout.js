// Functional components may contain hundreds of responsibilities. A fixed
// column cap makes their height grow without bound as the model grows.
export function functionalGridColumns(count, { width, height, gapX, gapY, targetAspect = 1.5 }) {
  if (count <= 1) return 1;
  let best = 1, bestScore = Infinity;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const gridWidth = columns * width + (columns - 1) * gapX;
    const gridHeight = rows * height + (rows - 1) * gapY;
    const score = Math.abs(Math.log((gridWidth / gridHeight) / targetAspect));
    if (score < bestScore) { best = columns; bestScore = score; }
  }
  return best;
}
