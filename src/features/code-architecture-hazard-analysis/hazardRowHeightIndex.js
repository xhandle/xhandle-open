// Prefix sums support distant scrollbar jumps and measured-height changes
// without walking every saved row on each scroll frame.
export default class HazardRowHeightIndex {
  constructor(heights) {
    this.heights = Float64Array.from(heights);
    this.tree = new Float64Array(heights.length + 1);
    this.total = 0;
    for (let i = 1; i < this.tree.length; i++) {
      this.tree[i] += this.heights[i - 1];
      const parent = i + (i & -i);
      if (parent < this.tree.length) this.tree[parent] += this.tree[i];
      this.total += this.heights[i - 1];
    }
  }

  offset(index) {
    let sum = 0;
    for (let i = index; i > 0; i -= i & -i) sum += this.tree[i];
    return sum;
  }

  set(index, height) {
    const delta = height - this.heights[index];
    this.heights[index] = height;
    this.total += delta;
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
  }

  indexAt(offset) {
    let index = 0, sum = 0, bit = 1;
    while (bit * 2 < this.tree.length) bit *= 2;
    for (; bit; bit = Math.floor(bit / 2)) {
      const next = index + bit;
      if (next < this.tree.length && sum + this.tree[next] <= offset) {
        index = next;
        sum += this.tree[next];
      }
    }
    return Math.max(0, Math.min(this.heights.length - 1, index));
  }
}
