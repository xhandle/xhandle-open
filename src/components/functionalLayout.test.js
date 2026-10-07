import { functionalGridColumns } from './functionalLayout';

const dimensions = { width: 240, height: 96, gapX: 216, gapY: 162 };
test.each([100, 708, 2000])('keeps a large Functional component balanced for %i functions', count => {
  const columns = functionalGridColumns(count, dimensions);
  const rows = Math.ceil(count / columns);
  const width = columns * dimensions.width + (columns - 1) * dimensions.gapX;
  const height = rows * dimensions.height + (rows - 1) * dimensions.gapY;
  expect(width / height).toBeGreaterThan(1.3);
  expect(width / height).toBeLessThan(1.7);
  if (count >= 708) expect(columns).toBeGreaterThan(8);
});
test.each([0, 1, 2, 5])('small components have valid deterministic grids: %i', count => {
  const columns = functionalGridColumns(count, dimensions);
  expect(columns).toBeGreaterThanOrEqual(1);
  expect(columns).toBeLessThanOrEqual(Math.max(1, count));
  expect(functionalGridColumns(count, dimensions)).toBe(columns);
});
