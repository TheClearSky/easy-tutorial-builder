/**
 * @theclearsky/easy-tutorial-builder — core (framework-free).
 *
 * - `defineKit` — the app's vocabulary (targets, events, predicates, assists)
 * - `defineTutorial` / plain JSON — the script (data only)
 * - `createTutorial` — run it: steps advance on the user's REAL actions,
 *   distractions route back via ordinary transitions, targets are tracked
 *   every frame (pan/zoom-safe), the spotlight lets task clicks through
 * - `highlight` — spotlight something once, no tour
 * - `createProgressStore` — completion + resume checkpoints
 *
 * `./react` has the React bindings, `./schema` validates JSON scripts (zod),
 * `./remote` starts tutorials sent from another tab over postMessage.
 */

export { argsMatch, byTourId, createEventBus, defineKit, defineTutorial, evaluateCondition, missingCapabilities } from './kit';
export type { AnyKit, Assist, EventBus, Kit, KitDefinition, KitTutorial, Predicate, TargetResolver } from './kit';
export { createTutorial } from './controller';
export type { ControllerEvents, CreateTutorialOptions, Failure, TutorialController, TutorialView } from './controller';
export { engineReducer, idleState } from './engine';
export type { EngineAction, EngineContext, EngineState, Outcome } from './engine';
export { createSpotlight } from './spotlight';
export type { Spotlight, SpotlightFrame, SpotlightOptions } from './spotlight';
export { createTracker } from './tracker';
export type { TrackedElements, TrackedRects, Tracker } from './tracker';
export { highlight } from './highlight';
export { mergeRects, spotlightPath } from './geometry';
export { createProgressStore } from './progress';
export type { Checkpoint, Finished, ProgressRecord, ProgressStore, StorageLike } from './progress';
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
} from './types';
