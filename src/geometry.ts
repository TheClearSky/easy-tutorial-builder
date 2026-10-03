import type { Rect } from './types';

/** Grow a rect by `by` on every side. */
function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Merge overlapping holes into their bounding boxes. An even-odd path turns
 * the overlap of two holes back into "dim" — a submenu overlapping its menu
 * would get a dark stripe through it.
 */
function mergeRects(rects: readonly Rect[]): Rect[] {
  const merged = rects.map((rect) => ({ ...rect }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (intersects(merged[i], merged[j])) {
          merged[i] = union(merged[i], merged[j]);
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}

function roundedRect({ x, y, width, height }: Rect, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return (
    `M${x + r},${y}H${x + width - r}A${r},${r} 0 0 1 ${x + width},${y + r}` +
    `V${y + height - r}A${r},${r} 0 0 1 ${x + width - r},${y + height}` +
    `H${x + r}A${r},${r} 0 0 1 ${x},${y + height - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`
  );
}

/**
 * The dim overlay as ONE even-odd path: the viewport minus rounded holes.
 * Holes are padded, merged where they overlap, and clamped to the viewport.
 */
function spotlightPath(viewport: { width: number; height: number }, holes: readonly Rect[], padding: number, radius: number): string {
  const outer = `M0,0H${viewport.width}V${viewport.height}H0Z`;
  const padded = mergeRects(holes.map((hole) => inflate(hole, padding)));
  return outer + padded.map((hole) => roundedRect(hole, radius)).join('');
}

/** Same rects at whole-pixel precision (so sub-pixel jitter doesn't redraw). */
function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (rect, index) =>
      Math.round(rect.x) === Math.round(b[index].x) &&
      Math.round(rect.y) === Math.round(b[index].y) &&
      Math.round(rect.width) === Math.round(b[index].width) &&
      Math.round(rect.height) === Math.round(b[index].height),
  );
}

export { inflate, intersects, mergeRects, sameRects, spotlightPath, union };
