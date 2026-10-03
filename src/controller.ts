import { currentStep, engineReducer, idleState } from './engine';
import type { EngineAction, EngineContext, EngineState, Outcome } from './engine';
import { evaluateCondition, missingCapabilities } from './kit';
import type { AnyKit } from './kit';
import type { ProgressStore } from './progress';
import { createSpotlight } from './spotlight';
import type { Spotlight, SpotlightOptions } from './spotlight';
import { createTracker } from './tracker';
import type { TrackedRects } from './tracker';
import type { AssistRef, Line, Placement, Rect, Step, TargetRef, Tutorial } from './types';

/**
 * A running tutorial: the engine + app events + a tick + target tracking +
 * the spotlight. Framework-free and imperative (drive it like driver.js),
 * observable (subscribe like Joyride). It draws only the spotlight; the
 * app renders its own speaker from `getView()`.
 */

type TutorialView = {
  readonly status: EngineState['status'];
  readonly outcome: Outcome | null;
  readonly error: string | null;
  readonly tutorial: { readonly id: string; readonly title: string; readonly revision: number };
  readonly step: Step | null;
  readonly stepIndex: number;
  readonly stepCount: number;
  /** What the guide says now (the step's lines). */
  readonly lines: readonly Line[];
  /** Extra lines after the step's timeout, if any. */
  readonly hint: readonly Line[] | null;
  /** The first visible target rect, and all of them. */
  readonly target: Rect | null;
  readonly targets: readonly Rect[];
  readonly allow: readonly Rect[];
  readonly placement: Placement;
  /** A pointing step whose element isn't on screen. */
  readonly waitingForTarget: boolean;
  /** A pointing step waiting for the user to act (no Next button). */
  readonly waitingForAction: boolean;
  readonly canNext: boolean;
  readonly canPrev: boolean;
  readonly options: readonly { readonly label: string }[];
  readonly assist: AssistRef | null;
  /** Bumps when the user clicks the dimmed area — a cue to nudge them. */
  readonly nudges: number;
};

type Failure = { readonly reason: 'target_not_found' | 'assist_failed' | 'missing_capability'; readonly stepId: string | null; readonly detail?: string };

type ControllerEvents = {
  step: (view: TutorialView) => void;
  finish: (outcome: Outcome, view: TutorialView) => void;
  failure: (failure: Failure) => void;
  outside: (event: PointerEvent) => void;
};

type CreateTutorialOptions = {
  kit: AnyKit;
  tutorial: Tutorial;
  /** Overlay options, or `false` for no overlay (e.g. a custom renderer). */
  spotlight?: SpotlightOptions | false;
  /** What a click on the dimmed area does: nothing gets through ('block',
   *  the default), it reaches the page ('pass'), or it skips ('skip'). */
  outsideClick?: 'block' | 'pass' | 'skip';
  /** Dim the page during say/choice/end steps (default true). */
  dimWhileTalking?: boolean;
  /** How long a pointing step waits for its element before a
   *  `target_not_found` failure is reported (it keeps waiting). */
  targetWaitMs?: number;
  tickMs?: number;
  progress?: ProgressStore;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
};

type TutorialController = {
  start(atStepId?: string): void;
  /** Resume from this tutorial's saved checkpoint (or the start). */
  resume(): void;
  next(): void;
  prev(): void;
  goTo(stepId: string): void;
  choose(index: number): void;
  skip(): void;
  /** Perform the current step's assist ("Show me"). */
  runAssist(): Promise<void>;
  /** Re-measure targets now (e.g. after a layout change you know about). */
  refresh(): void;
  destroy(): void;
  getView(): TutorialView;
  subscribe(listener: () => void): () => void;
  on<K extends keyof ControllerEvents>(type: K, handler: ControllerEvents[K]): () => void;
};

function createTutorial(options: CreateTutorialOptions): TutorialController {
  const { kit, tutorial, progress } = options;
  const now = options.now ?? (() => Date.now());
  const tickMs = options.tickMs ?? 250;
  const targetWaitMs = options.targetWaitMs ?? 4000;
  const outsideClick = options.outsideClick ?? 'block';
  const dimWhileTalking = options.dimWhileTalking ?? true;
  const predicates = kit.predicates ?? {};
  const context: EngineContext = { tutorial, evaluate: (condition) => evaluateCondition(condition, predicates) };

  let state: EngineState = idleState;
  let rects: TrackedRects = { primary: [], allow: [] };
  let nudges = 0;
  let reportedMissing: string | null = null;
  let destroyed = false;
  let view: TutorialView;
  const listeners = new Set<() => void>();
  const handlers: { [K in keyof ControllerEvents]: Set<ControllerEvents[K]> } = {
    step: new Set(),
    finish: new Set(),
    failure: new Set(),
    outside: new Set(),
  };
  const fire = <K extends keyof ControllerEvents>(type: K, ...args: Parameters<ControllerEvents[K]>) => {
    for (const handler of [...handlers[type]]) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch (error) {
        console.error('[easy-tutorial-builder] handler failed', error);
      }
    }
  };

  const resolveTargets = (refs: readonly TargetRef[]): Element[] =>
    refs.flatMap((ref) => {
      const resolver = kit.targets[ref.name as keyof typeof kit.targets] as
        | ((args: object) => Element | readonly Element[] | null)
        | undefined;
      if (!resolver) return [];
      try {
        const found = resolver(ref.args ?? {});
        return found === null ? [] : Array.isArray(found) ? [...found] : [found as Element];
      } catch {
        return [];
      }
    });

  let spotlight: Spotlight | null = null;
  const tracker = createTracker({
    resolve: () => {
      const step = currentStep(state, tutorial);
      if (!step || step.type !== 'point') return { primary: [], allow: [] };
      return { primary: resolveTargets([step.target]), allow: resolveTargets(step.allow ?? []) };
    },
    onChange: (next) => {
      rects = next;
      render();
    },
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame,
  });

  const buildView = (): TutorialView => {
    const step = currentStep(state, tutorial);
    // Position among the steps a user can SEE (branches are invisible), so
    // "3/7" never becomes "8/7".
    const visible: readonly Step[] = tutorial.steps.filter((candidate) => candidate.type !== 'branch');
    const stepIndex = step ? visible.indexOf(step) : -1;
    const pointing = step?.type === 'point';
    const hint = pointing && state.hint && step.hint ? step.hint : null;
    return {
      status: state.status,
      outcome: state.outcome,
      error: state.error,
      tutorial: { id: tutorial.id, title: tutorial.title, revision: tutorial.revision },
      step,
      stepIndex,
      stepCount: visible.length,
      lines: step && 'lines' in step ? step.lines : [],
      hint,
      target: rects.primary[0] ?? null,
      targets: rects.primary,
      allow: rects.allow,
      placement: pointing ? (step.placement ?? 'auto') : 'center',
      waitingForTarget: pointing && rects.primary.length === 0,
      waitingForAction: pointing && !step.next,
      canNext: !!step && (step.type === 'say' || step.type === 'end' || (step.type === 'point' && !!step.next)),
      canPrev: state.trail.length > 1,
      options: step?.type === 'choice' ? step.options.map((option) => ({ label: option.label })) : [],
      assist: pointing ? (step.assist ?? null) : null,
      nudges,
    };
  };

  const render = () => {
    view = buildView();
    if (spotlight) {
      const running = state.status === 'running';
      const pointing = view.step?.type === 'point';
      spotlight.update({
        holes: running ? [...rects.primary, ...rects.allow] : [],
        ring: running && pointing ? (rects.primary[0] ?? null) : null,
        dim: running && (pointing ? true : dimWhileTalking),
        blockOutside: running && outsideClick !== 'pass',
      });
    }
    for (const listener of [...listeners]) listener();
  };
  view = buildView();

  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let unsubscribeBus: (() => void) | null = null;

  const stopRunning = () => {
    tracker.stop();
    if (tickHandle !== null) clearInterval(tickHandle);
    tickHandle = null;
    unsubscribeBus?.();
    unsubscribeBus = null;
    spotlight?.destroy();
    spotlight = null;
  };

  const dispatch = (action: EngineAction) => {
    if (destroyed) return;
    const before = state;
    state = engineReducer(state, action, context);
    if (state === before) return;
    const stepChanged = state.stepId !== before.stepId || state.enteredAt !== before.enteredAt;
    if (stepChanged) {
      rects = { primary: [], allow: [] };
      reportedMissing = null;
    }
    if (state.status === 'finished') {
      stopRunning();
      progress?.markFinished(tutorial.id, tutorial.revision, state.outcome ?? 'completed');
      render();
      fire('finish', state.outcome ?? 'completed', view);
      return;
    }
    const step = currentStep(state, tutorial);
    if (stepChanged && step?.checkpoint) progress?.saveCheckpoint(tutorial.id, tutorial.revision, step.id);
    if (stepChanged) rects = tracker.measureNow();
    render();
    if (stepChanged) fire('step', view);
  };

  const tick = () => {
    dispatch({ type: 'tick', now: now() });
    const step = currentStep(state, tutorial);
    if (
      step?.type === 'point' &&
      state.status === 'running' &&
      rects.primary.length === 0 &&
      reportedMissing !== state.stepId &&
      now() - state.enteredAt >= targetWaitMs
    ) {
      reportedMissing = state.stepId;
      fire('failure', { reason: 'target_not_found', stepId: state.stepId });
    }
  };

  const begin = (atStepId?: string) => {
    if (destroyed) return;
    const missing = missingCapabilities(kit, tutorial);
    if (missing.length > 0) {
      state = { ...idleState, status: 'finished', outcome: 'aborted', error: `missing capability: ${missing.join(', ')}` };
      render();
      fire('failure', { reason: 'missing_capability', stepId: null, detail: missing.join(', ') });
      fire('finish', 'aborted', view);
      return;
    }
    stopRunning();
    if (options.spotlight !== false && typeof document !== 'undefined') {
      spotlight = createSpotlight({
        ...(options.spotlight ?? {}),
        onOutsidePointer: (event) => {
          nudges += 1;
          fire('outside', event);
          if (outsideClick === 'skip') dispatch({ type: 'skip' });
          else render();
        },
      });
    }
    unsubscribeBus = kit.bus.subscribe((event, args) => dispatch({ type: 'event', now: now(), name: event, args }));
    tickHandle = setInterval(tick, tickMs);
    dispatch({ type: 'start', now: now(), at: atStepId });
    if (state.status === 'running') tracker.start();
  };

  return {
    start: begin,
    resume() {
      begin(progress?.checkpointFor(tutorial.id, tutorial.revision) ?? undefined);
    },
    next: () => dispatch({ type: 'next', now: now() }),
    prev: () => dispatch({ type: 'prev', now: now() }),
    goTo: (stepId) => dispatch({ type: 'goto', now: now(), stepId }),
    choose: (index) => dispatch({ type: 'choose', now: now(), index }),
    skip: () => dispatch({ type: 'skip' }),
    async runAssist() {
      const step = currentStep(state, tutorial);
      if (step?.type !== 'point' || !step.assist) return;
      const assist = (kit.assists ?? {})[step.assist.name as keyof typeof kit.assists] as
        | ((args: object) => void | Promise<void>)
        | undefined;
      try {
        if (!assist) throw new Error(`unknown assist "${step.assist.name}"`);
        await assist(step.assist.args ?? {});
      } catch (error) {
        fire('failure', {
          reason: 'assist_failed',
          stepId: step.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    refresh() {
      rects = tracker.measureNow();
      render();
    },
    destroy() {
      if (destroyed) return;
      stopRunning();
      destroyed = true;
      listeners.clear();
    },
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    on(type, handler) {
      handlers[type].add(handler as never);
      return () => handlers[type].delete(handler as never);
    },
  };
}

export { createTutorial };
export type { ControllerEvents, CreateTutorialOptions, Failure, TutorialController, TutorialView };
