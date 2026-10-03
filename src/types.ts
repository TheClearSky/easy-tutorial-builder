/**
 * The tutorial script format — DATA ONLY. A script names things the app has
 * registered (targets, events, predicates, assists); it never contains code,
 * so a script loaded from a URL or another tab can't run anything.
 *
 * Every type is generic over the app's vocabulary, so a script written in
 * TypeScript gets autocompletion and type errors for unknown names, and the
 * same vocabulary produces a JSON Schema for `.json` scripts (`./schema`).
 */

/** Plain JSON values (arguments to targets, events, predicates, assists). */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonArgs = { readonly [key: string]: JsonValue };

/** How the guide feels while saying a line. The app's speaker renders it. */
type Mood = 'neutral' | 'happy' | 'excited' | 'thinking' | 'pointing' | 'surprised' | 'concerned' | 'celebrate';

/** One thing the guide says. Text supports a tiny markdown subset
 *  (`**bold**`, `*em*`, `` `code` ``, `[[key]]`) rendered by the app. */
type Line = { readonly say: string; readonly mood?: Mood };

/** A UI element, by registered name. */
type TargetRef<T extends string = string> = { readonly name: T; readonly args?: JsonArgs };

/** An app event, by registered name; `args` must match (subset). `count`:
 *  it must happen that many times while the step is showing. */
type EventRef<E extends string = string> = {
  readonly event: E;
  readonly args?: JsonArgs;
  readonly count?: number;
};

/** A condition over registered predicates. No expressions, no `eval`. */
type Condition<P extends string = string> =
  | { readonly pred: P; readonly args?: JsonArgs }
  | { readonly not: Condition<P> }
  | { readonly all: readonly Condition<P>[] }
  | { readonly any: readonly Condition<P>[] };

/** Where to go: the next step in order, back, the end, or a step id. */
type Goto = 'next' | 'prev' | 'end' | (string & {});

/** A way a step ends: an event happened, or a condition became true. */
type Transition<E extends string = string, P extends string = string> =
  | { readonly on: EventRef<E>; readonly goto: Goto }
  | { readonly when: Condition<P>; readonly goto: Goto };

/** A named, NON-destructive helper the app performs ("Show me": open a
 *  menu). Offered to the user, never run silently. */
type AssistRef<A extends string = string> = { readonly name: A; readonly args?: JsonArgs; readonly label?: string };

type Placement = 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center';

type StepBase<P extends string> = {
  readonly id: string;
  /** Already done? Skip this step — checked on entry AND while it waits. */
  readonly skipIf?: Condition<P>;
  /** Progress is saved here; a reload resumes from the last checkpoint. */
  readonly checkpoint?: boolean;
};

/** The guide talks; the user presses Next. */
type SayStep<P extends string> = StepBase<P> & {
  readonly type: 'say';
  readonly lines: readonly Line[];
};

/**
 * The guide points at `target` and waits for one of `advance` to happen —
 * the user doing the real thing, not pressing Next. `allow` are more places
 * the user may click (a submenu that opens outside the highlight).
 */
type PointStep<T extends string, E extends string, P extends string, A extends string> = StepBase<P> & {
  readonly type: 'point';
  readonly target: TargetRef<T>;
  readonly allow?: readonly TargetRef<T>[];
  readonly lines: readonly Line[];
  readonly advance: readonly Transition<E, P>[];
  /** After this long without advancing, the `hint` lines are shown. */
  readonly timeoutMs?: number;
  readonly hint?: readonly Line[];
  readonly assist?: AssistRef<A>;
  readonly placement?: Placement;
  /** Also offer a plain Next button (default: no — the action advances). */
  readonly next?: boolean;
};

/** The user picks where to go. */
type ChoiceStep<P extends string> = StepBase<P> & {
  readonly type: 'choice';
  readonly lines: readonly Line[];
  readonly options: readonly { readonly label: string; readonly goto: Goto }[];
};

/** Invisible: jump depending on a condition. */
type BranchStep<P extends string> = StepBase<P> & {
  readonly type: 'branch';
  readonly if: Condition<P>;
  readonly then: Goto;
  readonly else: Goto;
};

/** The last words. */
type EndStep<P extends string> = StepBase<P> & {
  readonly type: 'end';
  readonly lines: readonly Line[];
  readonly outcome?: 'completed' | 'aborted';
};

type Step<T extends string = string, E extends string = string, P extends string = string, A extends string = string> =
  | SayStep<P>
  | PointStep<T, E, P, A>
  | ChoiceStep<P>
  | BranchStep<P>
  | EndStep<P>;

/** A whole tutorial. */
type Tutorial<T extends string = string, E extends string = string, P extends string = string, A extends string = string> = {
  readonly $schema?: string;
  /** Script format version — bumps only on a breaking format change. */
  readonly format: 1;
  readonly id: string;
  /** Content revision, bumped by the author on any change. */
  readonly revision: number;
  readonly title: string;
  readonly summary?: string;
  readonly estimatedMinutes?: number;
  /** App capabilities this script needs; an app lacking one refuses it. */
  readonly requires?: readonly string[];
  readonly steps: readonly Step<T, E, P, A>[];
};

/** A viewport rectangle (CSS pixels). */
type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type {
  AssistRef,
  BranchStep,
  ChoiceStep,
  Condition,
  EndStep,
  EventRef,
  Goto,
  JsonArgs,
  JsonValue,
  Line,
  Mood,
  Placement,
  PointStep,
  Rect,
  SayStep,
  Step,
  TargetRef,
  Transition,
  Tutorial,
};
