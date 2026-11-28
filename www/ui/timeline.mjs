// Binary search keeps drawing and pitch-following proportional to the visible
// part of a song, including when seeking backwards or past a long held note.
export function lowerBound(items, value, key = 't') {
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (items[mid][key] < value) lo = mid + 1; else hi = mid; }
  return lo;
}

export class TimelineIndex {
  constructor(items = []) {
    this.items = items.slice().sort((a,b) => a.start - b.start);
    this.ends = new Float64Array(items.length);
    let end = -Infinity;
    for (let i = 0; i < this.items.length; i++) { end = Math.max(end, this.items[i].end); this.ends[i] = end; }
  }
  *between(start, end) {
    let lo = 0, hi = this.ends.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.ends[mid] < start) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < this.items.length && this.items[i].start <= end; i++) if (this.items[i].end >= start) yield this.items[i];
  }
}
