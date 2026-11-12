// Squarified treemap layout (Bruls, Huizing, van Wijk): rectangles close to square, so labels fit.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** values: positive, sorted biggest first. Returns one rect per value, in order, tiling `area`. */
export function squarify(values: number[], area: Rect): Rect[] {
  const total = values.reduce((a, v) => a + v, 0);
  if (total <= 0) return values.map(() => ({ ...area, w: 0, h: 0 }));
  const scale = (area.w * area.h) / total;
  const areas = values.map((v) => v * scale);
  const out: Rect[] = [];
  let free = { ...area };
  let row: number[] = [];

  const worst = (r: number[], side: number) => {
    const s = r.reduce((a, v) => a + v, 0);
    return Math.max((side * side * Math.max(...r)) / (s * s), (s * s) / (side * side * Math.min(...r)));
  };
  const place = (r: number[]) => {
    const s = r.reduce((a, v) => a + v, 0);
    if (free.w >= free.h) {
      const w = s / free.h;
      let y = free.y;
      for (const a of r) out.push({ x: free.x, y, w, h: a / w }), (y += a / w);
      free = { x: free.x + w, y: free.y, w: free.w - w, h: free.h };
    } else {
      const h = s / free.w;
      let x = free.x;
      for (const a of r) out.push({ x, y: free.y, w: a / h, h }), (x += a / h);
      free = { x: free.x, y: free.y + h, w: free.w, h: free.h - h };
    }
  };

  for (let i = 0; i < areas.length; ) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, areas[i]], side) <= worst(row, side)) row.push(areas[i++]);
    else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}
