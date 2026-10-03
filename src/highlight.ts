import { createSpotlight } from './spotlight';
import type { SpotlightOptions } from './spotlight';
import { createTracker } from './tracker';

/**
 * Spotlight something once, no tutorial (driver.js's `highlight`). The
 * element is re-found every frame, so it follows scrolling, pan/zoom and
 * re-mounts. Returns a handle to take it down.
 */
function highlight(
  find: () => Element | readonly Element[] | null,
  options: SpotlightOptions & { blockOutside?: boolean; dim?: boolean } = {},
): { destroy(): void } {
  const spotlight = createSpotlight(options);
  const tracker = createTracker({
    resolve: () => {
      const found = find();
      return { primary: found === null ? [] : Array.isArray(found) ? [...found] : [found as Element], allow: [] };
    },
    onChange: (rects) =>
      spotlight.update({
        holes: rects.primary,
        ring: rects.primary[0] ?? null,
        dim: options.dim ?? true,
        blockOutside: options.blockOutside ?? false,
      }),
  });
  tracker.start();
  return {
    destroy() {
      tracker.stop();
      spotlight.destroy();
    },
  };
}

export { highlight };
