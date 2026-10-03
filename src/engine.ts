import { argsMatch } from './kit';
import type { Condition, Goto, JsonArgs, Step, Tutorial } from './types';

/**
 * The step engine — a pure function `(state, action, context) → state`.
 * No timers, no DOM, no clock of its own: the controller feeds it the time
 * and app events, and asks it what to show. Every rule is table-testable.
 */

type Outcome = 'completed' | 'aborted' | 'skipped';

type EngineState = {
  readonly status: 'idle' | 'running' | 'finished';
  readonly outcome: Outcome | null;
  readonly stepId: string | null;
  /** Visited steps, for Back. */
  readonly trail: readonly string[];
  readonly enteredAt: number;
  /** The step's timeout passed: show its hint. */
  readonly hint: boolean;
  /** Per advance-transition index: how many matching events so far. */
  readonly counts: Readonly<Record<number, number>>;
  /** Why the tutorial ended early, when it did. */
  readonly error: string | null;
};

type EngineAction =
  | { readonly type: 'start'; readonly now: number; readonly at?: string }
  | { readonly type: 'next'; readonly now: number }
  | { readonly type: 'prev'; readonly now: number }
  | { readonly type: 'goto'; readonly now: number; readonly stepId: string }
  | { readonly type: 'choose'; readonly now: number; readonly index: number }
  | { readonly type: 'event'; readonly now: number; readonly name: string; readonly args: JsonArgs }
  /** Periodic: timeouts, `when` transitions, `skipIf` while waiting. */
  | { readonly type: 'tick'; readonly now: number }
  | { readonly type: 'skip' };

type EngineContext = {
  readonly tutorial: Tutorial;
  readonly evaluate: (condition: Condition) => boolean;
};

const idleState: EngineState = {
  status: 'idle',
  outcome: null,
  stepId: null,
  trail: [],
  enteredAt: 0,
  hint: false,
  counts: {},
  error: null,
};

function finish(state: EngineState, outcome: Outcome, error: string | null = null): EngineState {
  return { ...state, status: 'finished', outcome, error, hint: false, counts: {} };
}

function stepById(tutorial: Tutorial, id: string): { step: Step; index: number } | null {
  const index = tutorial.steps.findIndex((step) => step.id === id);
  return index < 0 ? null : { step: tutorial.steps[index], index };
}

/**
 * Enter `targetId`, following skipIf / branch hops. A cycle guard ends the
 * tutorial (aborted) instead of looping forever on a bad script.
 */
function enter(state: EngineState, targetId: string | null, now: number, context: EngineContext): EngineState {
  const { tutorial, evaluate } = context;
  let id = targetId;
  let trail = state.trail;
  for (let hops = 0; hops <= tutorial.steps.length * 2; hops++) {
    if (id === null) return finish({ ...state, trail }, 'completed');
    const found = stepById(tutorial, id);
    if (!found) return finish({ ...state, trail }, 'aborted', `unknown step "${id}"`);
    const { step, index } = found;
    if (step.skipIf && evaluate(step.skipIf)) {
      id = tutorial.steps[index + 1]?.id ?? null;
      continue;
    }
    if (step.type === 'branch') {
      const goto = evaluate(step.if) ? step.then : step.else;
      const resolved = resolveGoto(tutorial, index, goto, trail);
      if (resolved.kind === 'end') return finish({ ...state, trail }, 'completed');
      trail = resolved.trail;
      id = resolved.id;
      continue;
    }
    return {
      ...state,
      status: 'running',
      outcome: null,
      stepId: step.id,
      trail: trail[trail.length - 1] === step.id ? trail : [...trail, step.id],
      enteredAt: now,
      hint: false,
      counts: {},
      error: null,
    };
  }
  return finish(state, 'aborted', 'skip/branch cycle');
}

type Resolved = { kind: 'step'; id: string; trail: readonly string[] } | { kind: 'end' };

function resolveGoto(tutorial: Tutorial, fromIndex: number, goto: Goto, trail: readonly string[]): Resolved {
  if (goto === 'end') return { kind: 'end' };
  if (goto === 'next') {
    const next = tutorial.steps[fromIndex + 1];
    return next ? { kind: 'step', id: next.id, trail } : { kind: 'end' };
  }
  if (goto === 'prev') {
    // The step before this one in the trail (the current one is last).
    const previous = trail.slice(0, -1);
    const id = previous[previous.length - 1];
    return id ? { kind: 'step', id, trail: previous.slice(0, -1) } : { kind: 'step', id: tutorial.steps[0].id, trail: [] };
  }
  return { kind: 'step', id: goto, trail };
}

function go(state: EngineState, goto: Goto, now: number, context: EngineContext): EngineState {
  const current = state.stepId ? stepById(context.tutorial, state.stepId) : null;
  const resolved = resolveGoto(context.tutorial, current?.index ?? -1, goto, state.trail);
  if (resolved.kind === 'end') return finish(state, 'completed');
  return enter({ ...state, trail: resolved.trail }, resolved.id, now, context);
}

function engineReducer(state: EngineState, action: EngineAction, context: EngineContext): EngineState {
  if (action.type === 'start') {
    const first = action.at ?? context.tutorial.steps[0]?.id ?? null;
    return enter({ ...idleState }, first, action.now, context);
  }
  if (state.status !== 'running' || state.stepId === null) return state;
  const found = stepById(context.tutorial, state.stepId);
  if (!found) return finish(state, 'aborted', `unknown step "${state.stepId}"`);
  const { step } = found;

  switch (action.type) {
    case 'skip':
      return finish(state, 'skipped');
    case 'next':
      if (step.type === 'end') return finish(state, step.outcome ?? 'completed');
      return go(state, 'next', action.now, context);
    case 'prev':
      return go(state, 'prev', action.now, context);
    case 'goto':
      return enter(state, action.stepId, action.now, context);
    case 'choose': {
      if (step.type !== 'choice') return state;
      const option = step.options[action.index];
      return option ? go(state, option.goto, action.now, context) : state;
    }
    case 'event': {
      if (step.type !== 'point') return state;
      const counts: Record<number, number> = { ...state.counts };
      for (let index = 0; index < step.advance.length; index++) {
        const transition = step.advance[index];
        if (!('on' in transition)) continue;
        if (transition.on.event !== action.name || !argsMatch(transition.on.args, action.args)) continue;
        counts[index] = (counts[index] ?? 0) + 1;
        if (counts[index] >= (transition.on.count ?? 1)) return go(state, transition.goto, action.now, context);
      }
      return { ...state, counts };
    }
    case 'tick': {
      if (step.type !== 'point') return state;
      // Already done while we were waiting (the user got ahead of the guide).
      if (step.skipIf && context.evaluate(step.skipIf)) return go(state, 'next', action.now, context);
      for (const transition of step.advance) {
        if ('when' in transition && context.evaluate(transition.when)) {
          return go(state, transition.goto, action.now, context);
        }
      }
      const hint = step.timeoutMs !== undefined && action.now - state.enteredAt >= step.timeoutMs;
      return hint === state.hint ? state : { ...state, hint };
    }
  }
}

function currentStep(state: EngineState, tutorial: Tutorial): Step | null {
  return state.stepId ? (stepById(tutorial, state.stepId)?.step ?? null) : null;
}

export { currentStep, engineReducer, idleState };
export type { EngineAction, EngineContext, EngineState, Outcome };
