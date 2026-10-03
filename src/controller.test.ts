// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byTourId, defineKit } from './kit';
import { createTutorial } from './controller';
import { createProgressStore } from './progress';
import type { Tutorial } from './types';

// jsdom has no layout: give every element a fixed box.
function fakeLayout(element: Element, x: number) {
  element.getBoundingClientRect = () => ({ x, y: 10, width: 40, height: 20, top: 10, left: x, right: x + 40, bottom: 30, toJSON: () => ({}) }) as DOMRect;
}

function setup() {
  document.body.innerHTML = '<button data-tour="demos">Demos</button><div data-tour="keys"></div>';
  fakeLayout(byTourId('demos')!, 100);
  fakeLayout(byTourId('keys')!, 300);
  let open = false;
  const kit = defineKit({
    targets: { demos: () => byTourId('demos'), keys: () => byTourId('keys'), missing: () => null },
    events: ['menu.opened', 'note'],
    predicates: { menuOpen: () => open },
    assists: { openMenu: () => { open = true; } },
    capabilities: ['menus'],
  });
  const tutorial: Tutorial = {
    format: 1,
    id: 'demo',
    revision: 2,
    title: 'Demo',
    requires: ['menus'],
    steps: [
      { id: 'demos', type: 'point', target: { name: 'demos' }, lines: [{ say: 'Click' }], advance: [{ on: { event: 'menu.opened' }, goto: 'next' }], assist: { name: 'openMenu' } },
      { id: 'keys', type: 'point', target: { name: 'keys' }, lines: [{ say: 'Play' }], advance: [{ on: { event: 'note' }, goto: 'next' }], checkpoint: true },
      { id: 'lost', type: 'point', target: { name: 'missing' }, lines: [{ say: '?' }], advance: [{ when: { pred: 'menuOpen' }, goto: 'next' }] },
      { id: 'bye', type: 'end', lines: [{ say: 'Bye' }] },
    ],
  };
  return { kit, tutorial };
}

let frameCallbacks: (() => void)[] = [];
const requestFrame = (callback: () => void) => {
  frameCallbacks.push(callback);
  return frameCallbacks.length;
};
const flushFrame = () => {
  const pending = frameCallbacks;
  frameCallbacks = [];
  for (const callback of pending) callback();
};

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  frameCallbacks = [];
});

describe('controller', () => {
  it('points at real elements, advances on app events, and cleans up', () => {
    vi.useFakeTimers();
    const { kit, tutorial } = setup();
    const storage = new Map<string, string>();
    const progress = createProgressStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    });
    const tour = createTutorial({ kit, tutorial, progress, requestFrame, cancelFrame: () => {} });
    const finished = vi.fn();
    tour.on('finish', finished);
    tour.start();
    flushFrame();
    let view = tour.getView();
    expect(view.step?.id).toBe('demos');
    expect([view.stepIndex, view.stepCount]).toEqual([0, 4]);
    expect(view.target).toMatchObject({ x: 100, width: 40 });
    expect(view.waitingForAction).toBe(true);
    const overlay = document.querySelector('[data-easy-tutorial="spotlight"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector('path')!.getAttribute('d')!.match(/Z/g)).toHaveLength(2); // viewport + 1 hole

    kit.bus.emit('menu.opened');
    flushFrame();
    view = tour.getView();
    expect(view.step?.id).toBe('keys');
    expect(view.target).toMatchObject({ x: 300 });
    expect(progress.checkpointFor('demo', 2)).toBe('keys');

    kit.bus.emit('note');
    expect(tour.getView().step?.id).toBe('lost');
    expect(tour.getView().waitingForTarget).toBe(true);
    // A `when` transition fires from the tick.
    void tour.runAssist(); // no assist on this step: nothing happens
    tour.goTo('demos');
    void tour.runAssist();
    tour.goTo('lost');
    vi.advanceTimersByTime(300);
    expect(tour.getView().step?.id).toBe('bye');
    tour.next();
    expect(finished).toHaveBeenCalledWith('completed', expect.anything());
    expect(document.querySelector('[data-easy-tutorial="spotlight"]')).toBeNull();
    expect(progress.isCompleted('demo', 2)).toBe(true);
    expect(progress.checkpointFor('demo', 2)).toBeNull();
    tour.destroy();
  });

  it('reports a target that never appears, and keeps waiting', () => {
    vi.useFakeTimers();
    const { kit, tutorial } = setup();
    const tour = createTutorial({ kit, tutorial, requestFrame, cancelFrame: () => {}, targetWaitMs: 1000 });
    const failures: string[] = [];
    tour.on('failure', (failure) => failures.push(`${failure.reason}:${failure.stepId}`));
    tour.start('lost');
    vi.advanceTimersByTime(1500);
    expect(failures).toEqual(['target_not_found:lost']);
    expect(tour.getView().status).toBe('running');
    tour.destroy();
  });

  it('refuses a script needing a capability the app lacks', () => {
    const { kit, tutorial } = setup();
    const tour = createTutorial({ kit, tutorial: { ...tutorial, requires: ['time-travel'] }, requestFrame, cancelFrame: () => {} });
    tour.start();
    expect(tour.getView()).toMatchObject({ status: 'finished', outcome: 'aborted' });
    expect(document.querySelector('[data-easy-tutorial="spotlight"]')).toBeNull();
  });

  it('a click on the dimmed area is swallowed and counted as a nudge', () => {
    const { kit, tutorial } = setup();
    const tour = createTutorial({ kit, tutorial, requestFrame, cancelFrame: () => {} });
    const outside = vi.fn();
    tour.on('outside', outside);
    tour.start();
    const path = document.querySelector('[data-easy-tutorial="spotlight"] path')!;
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    path.dispatchEvent(event);
    expect(outside).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(tour.getView().nudges).toBe(1);
    tour.destroy();
  });
});
