import { inflate, mergeRects, spotlightPath } from './geometry';
import type { Rect } from './types';

/**
 * The dim overlay with holes — plain DOM + SVG, no framework.
 *
 * Clicks: the SVG root ignores the pointer; only the DIM area (the filled
 * part of the even-odd path) takes it. So everything under a hole is fully
 * usable — the target, and any `allow` regions such as a submenu that opens
 * outside it. A click on the dim area is reported (`onOutsidePointer`) and,
 * with `blockOutside`, swallowed — the "distraction" policy is the caller's.
 */

type SpotlightOptions = {
  /** Where the overlay lives (default `document.body`). */
  root?: HTMLElement;
  zIndex?: number;
  /** Space around each hole (px). */
  padding?: number;
  radius?: number;
  dimColor?: string;
  ringColor?: string;
  onOutsidePointer?(event: PointerEvent): void;
};

type SpotlightFrame = {
  /** Clickable holes: the target first, then `allow` regions. */
  holes: readonly Rect[];
  /** The ring (the thing the guide is pointing at). */
  ring: Rect | null;
  /** Dim the rest of the page. */
  dim: boolean;
  /** Swallow clicks on the dim area. */
  blockOutside: boolean;
};

type Spotlight = { update(frame: SpotlightFrame): void; destroy(): void; readonly element: SVGSVGElement };

const SVG = 'http://www.w3.org/2000/svg';

function createSpotlight(options: SpotlightOptions = {}): Spotlight {
  const root = options.root ?? document.body;
  const padding = options.padding ?? 8;
  const radius = options.radius ?? 8;
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-easy-tutorial', 'spotlight');
  Object.assign(svg.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: String(options.zIndex ?? 10000),
    overflow: 'visible',
  });
  const dim = document.createElementNS(SVG, 'path');
  dim.setAttribute('fill-rule', 'evenodd');
  dim.setAttribute('fill', options.dimColor ?? 'rgba(0, 0, 0, 0.55)');
  if (!reducedMotion) dim.style.transition = 'd 160ms ease-out, opacity 160ms ease-out';
  const ring = document.createElementNS(SVG, 'rect');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', options.ringColor ?? '#7b5cff');
  ring.setAttribute('stroke-width', '2');
  ring.style.pointerEvents = 'none';
  if (!reducedMotion) {
    const pulse = document.createElementNS(SVG, 'animate');
    pulse.setAttribute('attributeName', 'stroke-opacity');
    pulse.setAttribute('values', '1;0.35;1');
    pulse.setAttribute('dur', '1.6s');
    pulse.setAttribute('repeatCount', 'indefinite');
    ring.appendChild(pulse);
  }
  svg.append(dim, ring);
  root.appendChild(svg);

  let blockOutside = true;
  const onPointer = (event: PointerEvent) => {
    options.onOutsidePointer?.(event);
    if (blockOutside) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  dim.addEventListener('pointerdown', onPointer);
  dim.addEventListener('click', (event) => {
    if (blockOutside) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  return {
    element: svg,
    update(frame) {
      blockOutside = frame.blockOutside;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
      if (frame.dim) {
        dim.setAttribute('d', spotlightPath(viewport, frame.holes, padding, radius));
        dim.style.opacity = '1';
        dim.style.pointerEvents = frame.blockOutside ? 'fill' : 'none';
      } else {
        dim.style.opacity = '0';
        dim.style.pointerEvents = 'none';
      }
      if (frame.ring) {
        const [box] = mergeRects([inflate(frame.ring, padding)]);
        ring.setAttribute('x', String(box.x));
        ring.setAttribute('y', String(box.y));
        ring.setAttribute('width', String(box.width));
        ring.setAttribute('height', String(box.height));
        ring.setAttribute('rx', String(radius));
        ring.style.display = '';
      } else {
        ring.style.display = 'none';
      }
    },
    destroy() {
      dim.removeEventListener('pointerdown', onPointer);
      svg.remove();
    },
  };
}

export { createSpotlight };
export type { Spotlight, SpotlightFrame, SpotlightOptions };
