import { sameRects } from './geometry';
import type { Rect } from './types';

/**
 * Follows the current step's elements every animation frame.
 *
 * Why every frame (and not ResizeObserver/MutationObserver like most tour
 * libraries): a pan or zoom of a CSS-transformed canvas (ReactFlow) moves
 * elements without resizing or mutating anything, so observers never fire
 * and the highlight drifts. Re-resolving each frame also survives elements
 * that re-mount (a new node for the same id), portals, and scrolling.
 *
 * It only runs while a step is showing, and only notifies when a rect
 * actually moved (whole pixels).
 */

type TrackedElements = { primary: readonly Element[]; allow: readonly Element[] };
type TrackedRects = { primary: readonly Rect[]; allow: readonly Rect[] };

type TrackerOptions = {
  resolve(): TrackedElements;
  onChange(rects: TrackedRects): void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
};

function isShown(element: Element): boolean {
  if (!element.isConnected) return false;
  const checkable = element as Element & { checkVisibility?: (options?: object) => boolean };
  if (typeof checkable.checkVisibility === 'function' && !checkable.checkVisibility({ visibilityProperty: true })) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function rectsOf(elements: readonly Element[]): Rect[] {
  return elements.filter(isShown).map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}

type Tracker = { start(): void; stop(): void; measureNow(): TrackedRects };

function createTracker(options: TrackerOptions): Tracker {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  let handle: number | null = null;
  let last: TrackedRects = { primary: [], allow: [] };

  const measure = (): TrackedRects => {
    let elements: TrackedElements;
    try {
      elements = options.resolve();
    } catch {
      elements = { primary: [], allow: [] };
    }
    return { primary: rectsOf(elements.primary), allow: rectsOf(elements.allow) };
  };

  const frame = () => {
    handle = requestFrame(frame);
    const next = measure();
    if (!sameRects(next.primary, last.primary) || !sameRects(next.allow, last.allow)) {
      last = next;
      options.onChange(next);
    }
  };

  return {
    start() {
      if (handle !== null) return;
      last = { primary: [], allow: [] };
      frame();
    },
    stop() {
      if (handle !== null) cancelFrame(handle);
      handle = null;
    },
    measureNow() {
      last = measure();
      return last;
    },
  };
}

export { createTracker, rectsOf };
export type { TrackedElements, TrackedRects, Tracker };
