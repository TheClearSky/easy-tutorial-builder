import { describe, expect, it } from 'vitest';
import { engineReducer, idleState } from './engine';
import type { EngineAction, EngineState } from './engine';
import type { Condition, Tutorial } from './types';

const flags = new Set<string>();
const context = (tutorial: Tutorial) => ({
  tutorial,
  evaluate: function evaluate(condition: Condition): boolean {
    if ('pred' in condition) return flags.has(condition.pred);
    if ('not' in condition) return !evaluate(condition.not);
    if ('all' in condition) return condition.all.every(evaluate);
    return condition.any.some(evaluate);
  },
});
const run = (tutorial: Tutorial, ...actions: EngineAction[]) =>
  actions.reduce<EngineState>((state, action) => engineReducer(state, action, context(tutorial)), idleState);

const piano: Tutorial = {
  format: 1,
  id: 'open-piano',
  revision: 1,
  title: 'Open the piano',
  steps: [
    { id: 'hi', type: 'say', lines: [{ say: 'Hi' }] },
    {
      id: 'demos',
      type: 'point',
      target: { name: 'toolbar.demos' },
      skipIf: { pred: 'menuOpen' },
      lines: [{ say: 'Click Demos' }],
      advance: [{ on: { event: 'menu.opened' }, goto: 'next' }],
      timeoutMs: 5000,
      hint: [{ say: 'The purple button' }],
    },
    {
      id: 'piano',
      type: 'point',
      target: { name: 'menu.item', args: { id: 'piano' } },
      lines: [{ say: 'Click Piano' }],
      advance: [
        { on: { event: 'demo.loaded', args: { id: 'piano' } }, goto: 'next' },
        { on: { event: 'menu.closed' }, goto: 'demos' },
      ],
    },
    {
      id: 'play',
      type: 'point',
      target: { name: 'keys' },
      lines: [{ say: 'Press 3 keys' }],
      advance: [{ on: { event: 'note', count: 3 }, goto: 'next' }],
    },
    { id: 'done', type: 'end', lines: [{ say: 'Yay' }] },
  ],
};

describe('engine', () => {
  it('walks a tutorial on the user\'s real actions', () => {
    flags.clear();
    let state = run(piano, { type: 'start', now: 0 });
    expect(state.stepId).toBe('hi');
    state = engineReducer(state, { type: 'next', now: 1 }, context(piano));
    expect(state.stepId).toBe('demos');
    // An unrelated event does nothing; the right one advances.
    state = engineReducer(state, { type: 'event', now: 2, name: 'note', args: {} }, context(piano));
    expect(state.stepId).toBe('demos');
    state = engineReducer(state, { type: 'event', now: 3, name: 'menu.opened', args: {} }, context(piano));
    expect(state.stepId).toBe('piano');
    // Args must match (subset): a different demo is not "the piano".
    state = engineReducer(state, { type: 'event', now: 4, name: 'demo.loaded', args: { id: 'violin' } }, context(piano));
    expect(state.stepId).toBe('piano');
    state = engineReducer(state, { type: 'event', now: 5, name: 'demo.loaded', args: { id: 'piano', extra: 1 } }, context(piano));
    expect(state.stepId).toBe('play');
    for (let i = 0; i < 2; i++) state = engineReducer(state, { type: 'event', now: 6, name: 'note', args: {} }, context(piano));
    expect(state.stepId).toBe('play');
    state = engineReducer(state, { type: 'event', now: 7, name: 'note', args: {} }, context(piano));
    expect(state.stepId).toBe('done');
    state = engineReducer(state, { type: 'next', now: 8 }, context(piano));
    expect(state).toMatchObject({ status: 'finished', outcome: 'completed' });
  });

  it('a distraction routes back through an ordinary transition', () => {
    flags.clear();
    let state = run(piano, { type: 'start', now: 0, at: 'piano' });
    state = engineReducer(state, { type: 'event', now: 1, name: 'menu.closed', args: {} }, context(piano));
    expect(state.stepId).toBe('demos');
  });

  it('skips a step that is already done — on entry and while waiting', () => {
    flags.clear();
    flags.add('menuOpen');
    let state = run(piano, { type: 'start', now: 0 }, { type: 'next', now: 1 });
    expect(state.stepId).toBe('piano');
    flags.clear();
    state = run(piano, { type: 'start', now: 0, at: 'demos' });
    expect(state.stepId).toBe('demos');
    flags.add('menuOpen');
    state = engineReducer(state, { type: 'tick', now: 100 }, context(piano));
    expect(state.stepId).toBe('piano');
    flags.clear();
  });

  it('shows the hint after the timeout, and only then', () => {
    flags.clear();
    let state = run(piano, { type: 'start', now: 0, at: 'demos' });
    state = engineReducer(state, { type: 'tick', now: 4999 }, context(piano));
    expect(state.hint).toBe(false);
    state = engineReducer(state, { type: 'tick', now: 5000 }, context(piano));
    expect(state.hint).toBe(true);
  });

  it('when-transitions, branches and choices', () => {
    flags.clear();
    const tutorial: Tutorial = {
      format: 1,
      id: 't',
      revision: 1,
      title: 't',
      steps: [
        { id: 'fork', type: 'branch', if: { pred: 'hasFile' }, then: 'wait', else: 'ask' },
        { id: 'ask', type: 'choice', lines: [{ say: '?' }], options: [{ label: 'A', goto: 'wait' }, { label: 'B', goto: 'end' }] },
        { id: 'wait', type: 'point', target: { name: 'x' }, lines: [{ say: 'w' }], advance: [{ when: { all: [{ pred: 'a' }, { not: { pred: 'b' } }] }, goto: 'next' }] },
        { id: 'bye', type: 'end', lines: [{ say: 'bye' }], outcome: 'aborted' },
      ],
    };
    let state = run(tutorial, { type: 'start', now: 0 });
    expect(state.stepId).toBe('ask');
    state = engineReducer(state, { type: 'choose', now: 1, index: 0 }, context(tutorial));
    expect(state.stepId).toBe('wait');
    flags.add('a');
    flags.add('b');
    state = engineReducer(state, { type: 'tick', now: 2 }, context(tutorial));
    expect(state.stepId).toBe('wait');
    flags.delete('b');
    state = engineReducer(state, { type: 'tick', now: 3 }, context(tutorial));
    expect(state.stepId).toBe('bye');
    state = engineReducer(state, { type: 'next', now: 4 }, context(tutorial));
    expect(state.outcome).toBe('aborted');
    flags.clear();
    flags.add('hasFile');
    expect(run(tutorial, { type: 'start', now: 0 }).stepId).toBe('wait');
    flags.clear();
  });

  it('back goes to the previous VISITED step', () => {
    flags.clear();
    let state = run(piano, { type: 'start', now: 0 }, { type: 'next', now: 1 }, { type: 'event', now: 2, name: 'menu.opened', args: {} });
    expect(state.stepId).toBe('piano');
    state = engineReducer(state, { type: 'prev', now: 3 }, context(piano));
    expect(state.stepId).toBe('demos');
    state = engineReducer(state, { type: 'prev', now: 4 }, context(piano));
    expect(state.stepId).toBe('hi');
  });

  it('bad scripts end cleanly instead of hanging', () => {
    const broken: Tutorial = {
      format: 1,
      id: 'b',
      revision: 1,
      title: 'b',
      steps: [
        { id: 'a', type: 'branch', if: { pred: 'x' }, then: 'b', else: 'b' },
        { id: 'b', type: 'branch', if: { pred: 'x' }, then: 'a', else: 'a' },
      ],
    };
    expect(run(broken, { type: 'start', now: 0 })).toMatchObject({ status: 'finished', outcome: 'aborted' });
    expect(run(piano, { type: 'start', now: 0, at: 'nope' })).toMatchObject({ status: 'finished', outcome: 'aborted' });
    expect(run(piano, { type: 'start', now: 0 }, { type: 'skip' })).toMatchObject({ outcome: 'skipped' });
  });
});
