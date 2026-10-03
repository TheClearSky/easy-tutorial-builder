import type { Condition, JsonArgs, JsonValue, Tutorial } from './types';

/**
 * A kit is the app's vocabulary: what scripts may point at, wait for, ask
 * about and ask for. Scripts can only name these — that is what makes a
 * script safe to load from anywhere.
 */

/** Finds the element(s) for a target. Called every frame while a step
 *  shows, so it must be cheap and must not cache elements (they re-mount). */
type TargetResolver = (args: JsonArgs) => Element | readonly Element[] | null;
type Predicate = (args: JsonArgs) => boolean;
type Assist = (args: JsonArgs) => void | Promise<void>;

type KitDefinition<T extends string, E extends string, P extends string, A extends string> = {
  readonly targets: Readonly<Record<T, TargetResolver>>;
  readonly events: readonly E[];
  readonly predicates?: Readonly<Record<P, Predicate>>;
  readonly assists?: Readonly<Record<A, Assist>>;
  /** Features this app provides; a script's `requires` must be a subset. */
  readonly capabilities?: readonly string[];
};

type EventListener<E extends string> = (event: E, args: JsonArgs) => void;

/** A typed event bus. The app emits into it whether or not a tutorial runs. */
type EventBus<E extends string> = {
  emit(event: E, args?: JsonArgs): void;
  subscribe(listener: EventListener<E>): () => void;
};

type Kit<T extends string, E extends string, P extends string, A extends string> = KitDefinition<T, E, P, A> & {
  readonly bus: EventBus<E>;
  readonly targetNames: readonly T[];
  readonly predicateNames: readonly P[];
  readonly assistNames: readonly A[];
};

/** Any kit, when only structure matters. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKit = Kit<any, any, any, any>;

type KitTutorial<K> = K extends Kit<infer T, infer E, infer P, infer A> ? Tutorial<T, E, P, A> : never;

function createEventBus<E extends string>(): EventBus<E> {
  const listeners = new Set<EventListener<E>>();
  return {
    emit(event, args = {}) {
      for (const listener of [...listeners]) {
        try {
          listener(event, args);
        } catch (error) {
          // One broken listener must not stop the others.
          console.error('[easy-tutorial-builder] event listener failed', error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Declare the app's vocabulary. Name types are inferred from the keys. */
function defineKit<
  const T extends string,
  const E extends string,
  const P extends string = never,
  const A extends string = never,
>(definition: KitDefinition<T, E, P, A>): Kit<T, E, P, A> {
  return {
    ...definition,
    bus: createEventBus<E>(),
    targetNames: Object.keys(definition.targets) as T[],
    predicateNames: Object.keys(definition.predicates ?? {}) as P[],
    assistNames: Object.keys(definition.assists ?? {}) as A[],
  };
}

/** A tutorial written in TypeScript against a kit: unknown names are type
 *  errors. Returns the tutorial unchanged. */
function defineTutorial<T extends string, E extends string, P extends string, A extends string>(
  _kit: Kit<T, E, P, A>,
  tutorial: Tutorial<T, E, P, A>,
): Tutorial<T, E, P, A> {
  return tutorial;
}

/** Stable JSON equality for argument values. */
function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  }
  const keysA = Object.keys(a);
  const objectB = b as { [key: string]: JsonValue };
  return (
    keysA.length === Object.keys(objectB).length &&
    keysA.every((key) => sameJson((a as { [key: string]: JsonValue })[key], objectB[key]))
  );
}

/** Every key the script asks for must be present with the same value; the
 *  app may send more. */
function argsMatch(wanted: JsonArgs | undefined, actual: JsonArgs): boolean {
  if (!wanted) return true;
  return Object.keys(wanted).every((key) => sameJson(wanted[key], actual[key]));
}

/** Evaluate a condition. An unknown or failing predicate counts as false —
 *  a broken predicate must never skip steps the user hasn't done. */
function evaluateCondition(condition: Condition, predicates: Readonly<Record<string, Predicate>>): boolean {
  if ('pred' in condition) {
    const predicate = predicates[condition.pred];
    if (!predicate) return false;
    try {
      return predicate(condition.args ?? {}) === true;
    } catch {
      return false;
    }
  }
  if ('not' in condition) return !evaluateCondition(condition.not, predicates);
  if ('all' in condition) return condition.all.every((part) => evaluateCondition(part, predicates));
  return condition.any.some((part) => evaluateCondition(part, predicates));
}

/** Capabilities a script needs that the kit lacks (empty = runnable). */
function missingCapabilities(kit: AnyKit, tutorial: Tutorial): string[] {
  const have = new Set(kit.capabilities ?? []);
  return (tutorial.requires ?? []).filter((capability) => !have.has(capability));
}

/** `[data-tour="id"]` — the recommended way to mark targets. */
function byTourId(id: string, root: ParentNode = document): Element | null {
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  return root.querySelector(`[data-tour="${escaped}"]`);
}

export {
  argsMatch,
  byTourId,
  createEventBus,
  defineKit,
  defineTutorial,
  evaluateCondition,
  missingCapabilities,
  sameJson,
};
export type { AnyKit, Assist, EventBus, Kit, KitDefinition, KitTutorial, Predicate, TargetResolver };
