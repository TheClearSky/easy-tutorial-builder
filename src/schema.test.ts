import { describe, expect, it } from 'vitest';
import { defineKit } from './kit';
import { parseTutorial, tutorialJsonSchema } from './schema';
import { mergeRects, spotlightPath } from './geometry';

const kit = defineKit({
  targets: { 'toolbar.demos': () => null, 'menu.item': () => null },
  events: ['menu.opened', 'demo.loaded'],
  predicates: { menuOpen: () => false },
  assists: { openMenu: () => {} },
  capabilities: ['demosMenu'],
});

type LooseStep = { id: string; advance?: { on?: { event: string }; goto: string }[] } & Record<string, unknown>;
type LooseScript = { steps: LooseStep[] } & Record<string, unknown>;

const good: LooseScript = {
  format: 1,
  id: 'open-piano',
  revision: 1,
  title: 'Open the piano',
  requires: ['demosMenu'],
  steps: [
    {
      id: 'demos',
      type: 'point',
      target: { name: 'toolbar.demos' },
      skipIf: { pred: 'menuOpen' },
      lines: [{ say: 'Click **Demos**', mood: 'pointing' }],
      advance: [{ on: { event: 'menu.opened' }, goto: 'done' }],
      assist: { name: 'openMenu', label: 'Show me' },
    },
    { id: 'done', type: 'end', lines: [{ say: 'Done' }] },
  ],
};

describe('schema', () => {
  it('accepts a valid script (object or JSON text)', () => {
    expect(parseTutorial(kit, good).ok).toBe(true);
    expect(parseTutorial(kit, JSON.stringify(good)).ok).toBe(true);
  });

  it('rejects names the app never registered, and says where', () => {
    const bad = structuredClone(good);
    bad.steps[0].advance![0].on!.event = 'menu.opend';
    const result = parseTutorial(kit, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].path).toBe('steps.0.advance.0.on.event');
  });

  it('rejects gotos to missing steps, duplicate ids, unknown keys and code-like extras', () => {
    const missing = structuredClone(good);
    missing.steps[0].advance![0].goto = 'nowhere';
    expect(parseTutorial(kit, missing).ok).toBe(false);
    const dup = structuredClone(good);
    dup.steps[1].id = 'demos';
    expect(parseTutorial(kit, dup).ok).toBe(false);
    expect(parseTutorial(kit, { ...good, onStart: 'alert(1)' }).ok).toBe(false);
  });

  it('checks the size BEFORE parsing', () => {
    const result = parseTutorial(kit, JSON.stringify(good), { maxBytes: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toMatch(/limit is 50/);
    expect(parseTutorial(kit, '{not json').ok).toBe(false);
  });

  it('emits a JSON Schema that lists the kit\'s names', () => {
    const text = JSON.stringify(tutorialJsonSchema(kit));
    expect(text).toContain('toolbar.demos');
    expect(text).toContain('menu.opened');
    expect(text).toContain('openMenu');
  });
});

describe('geometry', () => {
  it('merges overlapping holes (even-odd would re-dim the overlap)', () => {
    const merged = mergeRects([
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 90, y: 10, width: 100, height: 100 },
      { x: 500, y: 500, width: 10, height: 10 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ x: 0, y: 0, width: 190, height: 110 });
  });

  it('builds one path: the viewport plus one subpath per hole', () => {
    const d = spotlightPath({ width: 800, height: 600 }, [{ x: 10, y: 10, width: 50, height: 20 }], 4, 6);
    expect(d.startsWith('M0,0H800V600H0Z')).toBe(true);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});
