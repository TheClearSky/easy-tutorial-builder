import { missingCapabilities } from '../kit';
import type { AnyKit } from '../kit';
import { parseTutorial } from '../schema';
import type { ParseIssue } from '../schema';
import type { Tutorial } from '../types';

/**
 * Start a tutorial that another tab sends over `postMessage` — typically a
 * docs site opening the app with a script to walk the user through.
 *
 * THE APP SPEAKS FIRST. The docs page listens before opening the app; the
 * app says `etb:ready` only once its own listener is installed, and repeats
 * it until answered. So nobody ever posts to a listener that may not exist.
 *
 *   docs: listen → window.open(app?etb=1&etbFrom=<docs origin>)
 *   app:  (first module, before any UI) → ready{nonce} ×N → docs
 *   docs: start{nonce, requestId, script} → app
 *   app:  checks → queue (sessionStorage) → onRequest → user consents
 *   app:  accepted | rejected{reason} → docs
 *
 * Every check (exact origin, the opener window, nonce, one request per load,
 * size before parsing, schema, capabilities, framing) is in `receive()`.
 */

const PROTOCOL = 1;
const PENDING_KEY = 'etb.pending';

type RejectReason =
  | 'origin'
  | 'protocol'
  | 'invalid'
  | 'capability'
  | 'busy'
  | 'already-handled'
  | 'too-large'
  | 'declined'
  | 'timeout';

type ReadyMessage = { type: 'etb:ready'; protocol: number; nonce: string; accepts: { format: number[]; capabilities: string[] } };
type StartMessage = { type: 'etb:start'; protocol: number; nonce: string; requestId: string; script: string };
type AnswerMessage =
  | { type: 'etb:accepted'; requestId: string }
  | { type: 'etb:rejected'; requestId: string; reason: RejectReason; detail?: string };

/** A validated script waiting for the user's yes/no. */
type RemoteRequest = { requestId: string; origin: string; tutorial: Tutorial; receivedAt: number };

type AcceptOptions = {
  kit: AnyKit;
  /** Exact origins (`https://docs.example.com`) — no wildcards. */
  allowedOrigins: readonly string[];
  maxBytes?: number;
  /** Starts are accepted only this long after load. */
  handshakeWindowMs?: number;
  readyIntervalMs?: number;
  readyForMs?: number;
  /** Where a received request waits for the UI (default sessionStorage). */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Queued requests older than this are dropped (default 10 min). */
  maxQueueAgeMs?: number;
  /** Accept even inside an iframe (default false — clickjacking). */
  allowInFrame?: boolean;
  /** Strip `etb`/`etbFrom` from the address bar (default true). */
  cleanUrl?: boolean;
  win?: Window;
  now?: () => number;
};

type RemoteReceiver = {
  /** The waiting request, if any (e.g. after a reload or the landing). */
  pending(): RemoteRequest | null;
  /** Called with each new request (and immediately with a queued one). */
  onRequest(listener: (request: RemoteRequest) => void): () => void;
  /** The user's answer (or the app's). Clears the queue. */
  respond(requestId: string, answer: 'accept' | { reject: RejectReason; detail?: string }): void;
  dispose(): void;
};

function randomNonce(win: Window): string {
  const cryptoApi = win.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && url.origin !== 'null';
  } catch {
    return false;
  }
}

function acceptRemoteTutorials(options: AcceptOptions): RemoteReceiver {
  const win = options.win ?? window;
  const now = options.now ?? (() => Date.now());
  const storage = options.storage === undefined ? safeSessionStorage(win) : options.storage;
  const maxBytes = options.maxBytes ?? 512_000;
  const handshakeWindowMs = options.handshakeWindowMs ?? 60_000;
  const readyIntervalMs = options.readyIntervalMs ?? 500;
  const readyForMs = options.readyForMs ?? 15_000;
  const maxQueueAgeMs = options.maxQueueAgeMs ?? 10 * 60_000;
  const allowed = new Set(options.allowedOrigins.filter(isOrigin));
  const loadedAt = now();
  const listeners = new Set<(request: RemoteRequest) => void>();

  const params = new URL(win.location.href).searchParams;
  const claimedOpener = params.get('etbFrom');
  if (options.cleanUrl !== false && (params.has('etb') || params.has('etbFrom'))) {
    const url = new URL(win.location.href);
    url.searchParams.delete('etb');
    url.searchParams.delete('etbFrom');
    try {
      win.history.replaceState(win.history.state, '', url.toString());
    } catch {
      // not fatal
    }
  }

  const framed = (() => {
    try {
      return win.top !== win.self;
    } catch {
      return true;
    }
  })();
  const opener = win.opener as Window | null;
  const nonce = randomNonce(win);
  let handled = false;
  let readyTimer: ReturnType<typeof setInterval> | null = null;

  const listening =
    params.get('etb') === '1' &&
    claimedOpener !== null &&
    allowed.has(claimedOpener) &&
    opener !== null &&
    (!framed || options.allowInFrame === true);

  const post = (message: ReadyMessage | AnswerMessage, origin: string) => {
    try {
      opener?.postMessage(message, origin);
    } catch {
      // the opener went away
    }
  };

  const readQueued = (): RemoteRequest | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(PENDING_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as { requestId?: unknown; origin?: unknown; script?: unknown; receivedAt?: unknown };
      if (
        typeof stored.requestId !== 'string' ||
        typeof stored.origin !== 'string' ||
        typeof stored.script !== 'string' ||
        typeof stored.receivedAt !== 'number' ||
        now() - stored.receivedAt > maxQueueAgeMs ||
        !allowed.has(stored.origin)
      ) {
        storage.removeItem(PENDING_KEY);
        return null;
      }
      // Re-validated on every read: the app may have changed since.
      const parsed = parseTutorial(options.kit, stored.script, { maxBytes });
      if (!parsed.ok || missingCapabilities(options.kit, parsed.tutorial).length > 0) {
        storage.removeItem(PENDING_KEY);
        return null;
      }
      return { requestId: stored.requestId, origin: stored.origin, tutorial: parsed.tutorial, receivedAt: stored.receivedAt };
    } catch {
      return null;
    }
  };

  const reject = (origin: string, requestId: string, reason: RejectReason, detail?: string) =>
    post({ type: 'etb:rejected', requestId, reason, ...(detail ? { detail } : {}) }, origin);

  const receive = (event: MessageEvent) => {
    const data = event.data as Partial<StartMessage> | null;
    if (!data || typeof data !== 'object' || data.type !== 'etb:start') return;
    // Only the window that opened us, from an allowed origin, with our nonce.
    if (event.source !== opener || !allowed.has(event.origin) || event.origin !== claimedOpener) return;
    if (data.nonce !== nonce) return;
    const requestId = typeof data.requestId === 'string' ? data.requestId.slice(0, 64) : '';
    if (handled) return reject(event.origin, requestId, 'already-handled');
    if (now() - loadedAt > handshakeWindowMs) return reject(event.origin, requestId, 'timeout');
    if (data.protocol !== PROTOCOL) return reject(event.origin, requestId, 'protocol');
    if (typeof data.script !== 'string') return reject(event.origin, requestId, 'invalid', 'script must be a JSON string');
    if (new TextEncoder().encode(data.script).length > maxBytes) return reject(event.origin, requestId, 'too-large');
    const parsed = parseTutorial(options.kit, data.script, { maxBytes });
    if (!parsed.ok) return reject(event.origin, requestId, 'invalid', formatIssues(parsed.issues));
    const missing = missingCapabilities(options.kit, parsed.tutorial);
    if (missing.length > 0) return reject(event.origin, requestId, 'capability', missing.join(', '));
    handled = true;
    stopReady();
    const request: RemoteRequest = { requestId, origin: event.origin, tutorial: parsed.tutorial, receivedAt: now() };
    try {
      storage?.setItem(
        PENDING_KEY,
        JSON.stringify({ requestId, origin: event.origin, script: data.script, receivedAt: request.receivedAt }),
      );
    } catch {
      // too big for storage: it still reaches listeners in this page
    }
    for (const listener of [...listeners]) listener(request);
  };

  const stopReady = () => {
    if (readyTimer !== null) clearInterval(readyTimer);
    readyTimer = null;
  };

  if (listening && claimedOpener) {
    win.addEventListener('message', receive);
    const ready: ReadyMessage = {
      type: 'etb:ready',
      protocol: PROTOCOL,
      nonce,
      accepts: { format: [1], capabilities: [...(options.kit.capabilities ?? [])] },
    };
    post(ready, claimedOpener);
    readyTimer = setInterval(() => {
      if (handled || now() - loadedAt > readyForMs) return stopReady();
      post(ready, claimedOpener);
    }, readyIntervalMs);
  }

  let memoryPending: RemoteRequest | null = null;
  listeners.add((request) => {
    memoryPending = request;
  });

  return {
    pending: () => readQueued() ?? memoryPending,
    onRequest(listener) {
      listeners.add(listener);
      const queued = readQueued() ?? memoryPending;
      if (queued) listener(queued);
      return () => listeners.delete(listener);
    },
    respond(requestId, answer) {
      const current = readQueued() ?? memoryPending;
      try {
        storage?.removeItem(PENDING_KEY);
      } catch {
        // nothing queued
      }
      memoryPending = null;
      if (!current || current.requestId !== requestId) return;
      if (answer === 'accept') post({ type: 'etb:accepted', requestId }, current.origin);
      else reject(current.origin, requestId, answer.reject, answer.detail);
    },
    dispose() {
      stopReady();
      win.removeEventListener('message', receive);
      listeners.clear();
    },
  };
}

function formatIssues(issues: readonly ParseIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join('; ')
    .slice(0, 500);
}

function safeSessionStorage(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

// ── the sender (docs site) ─────────────────────────────────────────────

type LaunchResult =
  | { status: 'accepted' }
  | { status: 'rejected'; reason: RejectReason; detail?: string }
  /** The popup blocker stopped `window.open` (call this from a click). */
  | { status: 'blocked' }
  /** No `ready` arrived: the link to the app was cut (noopener/COOP), the
   *  app isn't on this origin's allow-list, or it didn't load in time. */
  | { status: 'no-opener' }
  | { status: 'closed' }
  | { status: 'timeout' };

type LaunchOptions = {
  /** The app's address (its origin is derived from it). */
  appUrl: string;
  /** The script, as an object or JSON text. */
  script: unknown;
  /** Overall limit (default 120 s — the user reads the app and consents first). */
  timeoutMs?: number;
  /** Wait at most this for the first `ready` (default 15 s). */
  readyTimeoutMs?: number;
  requestId?: string;
  win?: Window;
};

/**
 * Open the app in a NEW tab and hand it a tutorial. Call from a click
 * handler (popup blockers). Always `_blank` — targeting an existing named
 * app tab would navigate (reload) the user's working session.
 */
function launchTutorial(options: LaunchOptions): Promise<LaunchResult> {
  const win = options.win ?? window;
  const appUrl = new URL(options.appUrl, win.location.href);
  const appOrigin = appUrl.origin;
  const script = typeof options.script === 'string' ? options.script : JSON.stringify(options.script);
  const requestId = options.requestId ?? `req-${Math.random().toString(36).slice(2, 10)}`;
  appUrl.searchParams.set('etb', '1');
  appUrl.searchParams.set('etbFrom', win.location.origin);

  return new Promise((resolve) => {
    let opened: Window | null = null;
    let sent = false;
    let settled = false;
    let overall: ReturnType<typeof setTimeout> | undefined;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    let closedPoll: ReturnType<typeof setInterval> | undefined;
    const finish = (result: LaunchResult) => {
      if (settled) return;
      settled = true;
      win.removeEventListener('message', onMessage);
      clearTimeout(overall);
      clearTimeout(readyTimeout);
      clearInterval(closedPoll);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opened || event.origin !== appOrigin) return;
      const data = event.data as { type?: unknown; nonce?: unknown; requestId?: unknown; reason?: unknown; detail?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'etb:ready' && !sent && typeof data.nonce === 'string') {
        sent = true;
        const start: StartMessage = { type: 'etb:start', protocol: PROTOCOL, nonce: data.nonce, requestId, script };
        opened?.postMessage(start, appOrigin);
      } else if (data.type === 'etb:accepted' && data.requestId === requestId) {
        finish({ status: 'accepted' });
      } else if (data.type === 'etb:rejected' && data.requestId === requestId) {
        finish({
          status: 'rejected',
          reason: (typeof data.reason === 'string' ? data.reason : 'invalid') as RejectReason,
          detail: typeof data.detail === 'string' ? data.detail : undefined,
        });
      }
    };
    // Listen BEFORE opening — the app's first `ready` may arrive quickly.
    win.addEventListener('message', onMessage);
    opened = win.open(appUrl.toString(), '_blank');
    if (!opened) return finish({ status: 'blocked' });
    overall = setTimeout(() => finish({ status: 'timeout' }), options.timeoutMs ?? 120_000);
    readyTimeout = setTimeout(() => {
      if (!sent) finish({ status: 'no-opener' });
    }, options.readyTimeoutMs ?? 15_000);
    closedPoll = setInterval(() => {
      if (opened?.closed) finish({ status: 'closed' });
    }, 500);
  });
}

export { acceptRemoteTutorials, launchTutorial, PROTOCOL };
export type { AcceptOptions, AnswerMessage, LaunchOptions, LaunchResult, ReadyMessage, RejectReason, RemoteReceiver, RemoteRequest, StartMessage };
