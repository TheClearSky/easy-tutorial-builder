/**
 * Which tutorials were finished (by revision) and where an interrupted one
 * stopped — one JSON value under one key. Every read is validated; a broken
 * or foreign value reads as "no progress", never as an error.
 */

type Finished = { readonly revision: number; readonly outcome: 'completed' | 'aborted' | 'skipped'; readonly at: number };
type Checkpoint = { readonly id: string; readonly revision: number; readonly stepId: string; readonly at: number };
type ProgressRecord = { readonly finished: Readonly<Record<string, Finished>>; readonly checkpoint: Checkpoint | null };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type ProgressStore = {
  read(): ProgressRecord;
  isCompleted(id: string, revision?: number): boolean;
  markFinished(id: string, revision: number, outcome: Finished['outcome']): void;
  saveCheckpoint(id: string, revision: number, stepId: string): void;
  /** The checkpoint of this exact tutorial revision, if one is recent enough. */
  checkpointFor(id: string, revision: number, maxAgeMs?: number): string | null;
  clearCheckpoint(): void;
  reset(): void;
};

const EMPTY: ProgressRecord = { finished: {}, checkpoint: null };
const DAY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(raw: string | null): ProgressRecord {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return EMPTY;
    const finished: Record<string, Finished> = {};
    if (isRecord(value.finished)) {
      for (const [id, entry] of Object.entries(value.finished)) {
        if (
          isRecord(entry) &&
          typeof entry.revision === 'number' &&
          (entry.outcome === 'completed' || entry.outcome === 'aborted' || entry.outcome === 'skipped') &&
          typeof entry.at === 'number'
        ) {
          finished[id] = { revision: entry.revision, outcome: entry.outcome, at: entry.at };
        }
      }
    }
    const c = value.checkpoint;
    const checkpoint =
      isRecord(c) &&
      typeof c.id === 'string' &&
      typeof c.revision === 'number' &&
      typeof c.stepId === 'string' &&
      typeof c.at === 'number'
        ? { id: c.id, revision: c.revision, stepId: c.stepId, at: c.at }
        : null;
    return { finished, checkpoint };
  } catch {
    return EMPTY;
  }
}

function createProgressStore(
  storage: StorageLike | null,
  key = 'easy-tutorial-builder.progress',
  now: () => number = Date.now,
): ProgressStore {
  let memory: ProgressRecord = EMPTY;
  const read = (): ProgressRecord => {
    if (!storage) return memory;
    try {
      return parse(storage.getItem(key));
    } catch {
      return memory;
    }
  };
  const write = (record: ProgressRecord) => {
    memory = record;
    try {
      storage?.setItem(key, JSON.stringify(record));
    } catch {
      // Private mode / quota: keep it for this page only.
    }
  };
  return {
    read,
    isCompleted(id, revision) {
      const entry = read().finished[id];
      return !!entry && entry.outcome === 'completed' && (revision === undefined || entry.revision >= revision);
    },
    markFinished(id, revision, outcome) {
      const record = read();
      write({ finished: { ...record.finished, [id]: { revision, outcome, at: now() } }, checkpoint: null });
    },
    saveCheckpoint(id, revision, stepId) {
      write({ ...read(), checkpoint: { id, revision, stepId, at: now() } });
    },
    checkpointFor(id, revision, maxAgeMs = DAY_MS) {
      const checkpoint = read().checkpoint;
      if (!checkpoint || checkpoint.id !== id || checkpoint.revision !== revision) return null;
      return now() - checkpoint.at <= maxAgeMs ? checkpoint.stepId : null;
    },
    clearCheckpoint() {
      write({ ...read(), checkpoint: null });
    },
    reset() {
      try {
        storage?.removeItem(key);
      } catch {
        // nothing to do
      }
      memory = EMPTY;
    },
  };
}

export { createProgressStore };
export type { Checkpoint, Finished, ProgressRecord, ProgressStore, StorageLike };
