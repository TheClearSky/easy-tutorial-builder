import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createTutorial } from '../controller';
import type { CreateTutorialOptions, TutorialController, TutorialView } from '../controller';
import type { Outcome } from '../engine';
import type { AnyKit } from '../kit';
import type { Tutorial } from '../types';

/**
 * React bindings. The library still draws only the spotlight; your
 * component renders the guide from `view` (lines, mood, target rect, the
 * buttons it should offer).
 */

/** Subscribe to a controller. `null` → `null`. */
function useTutorialView(controller: TutorialController | null): TutorialView | null {
  const subscribe = useCallback(
    (listener: () => void) => (controller ? controller.subscribe(listener) : () => {}),
    [controller],
  );
  return useSyncExternalStore(subscribe, () => controller?.getView() ?? null, () => null);
}

type TutorialContextValue = {
  /** The running tutorial's controller (null when none). */
  controller: TutorialController | null;
  view: TutorialView | null;
  /** Start a tutorial (stops a running one first). */
  start(tutorial: Tutorial, options?: { at?: string; resume?: boolean }): TutorialController;
  stop(): void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

type TutorialProviderProps = Omit<CreateTutorialOptions, 'kit' | 'tutorial'> & {
  kit: AnyKit;
  children?: ReactNode;
  /** Called when a tutorial ends (completed / aborted / skipped). */
  onFinish?(tutorialId: string, outcome: Outcome): void;
};

/** Owns "the tutorial that is running" for a subtree. */
function TutorialProvider({ kit, children, onFinish, ...controllerOptions }: TutorialProviderProps) {
  const [controller, setController] = useState<TutorialController | null>(null);
  const optionsRef = useRef(controllerOptions);
  optionsRef.current = controllerOptions;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const controllerRef = useRef<TutorialController | null>(null);

  const stop = useCallback(() => {
    controllerRef.current?.destroy();
    controllerRef.current = null;
    setController(null);
  }, []);

  const start = useCallback(
    (tutorial: Tutorial, startOptions: { at?: string; resume?: boolean } = {}) => {
      controllerRef.current?.destroy();
      const next = createTutorial({ ...optionsRef.current, kit, tutorial });
      next.on('finish', (outcome) => onFinishRef.current?.(tutorial.id, outcome));
      controllerRef.current = next;
      setController(next);
      if (startOptions.resume) next.resume();
      else next.start(startOptions.at);
      return next;
    },
    [kit],
  );

  useEffect(() => () => controllerRef.current?.destroy(), []);
  const view = useTutorialView(controller);
  const value = useMemo(() => ({ controller, view, start, stop }), [controller, view, start, stop]);
  return createElement(TutorialContext.Provider, { value }, children);
}

function useTutorial(): TutorialContextValue {
  const value = useContext(TutorialContext);
  if (!value) throw new Error('useTutorial must be used inside <TutorialProvider>');
  return value;
}

export { TutorialProvider, useTutorial, useTutorialView };
export type { TutorialContextValue, TutorialProviderProps };
