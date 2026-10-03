// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineKit } from './kit';
import { acceptRemoteTutorials, launchTutorial } from './remote';

const kit = defineKit({ targets: { demos: () => null }, events: ['menu.opened'], capabilities: ['demosMenu'] });
const script = {
  format: 1,
  id: 'remote-demo',
  revision: 1,
  title: 'Remote',
  steps: [{ id: 'hi', type: 'say', lines: [{ say: 'Hi from the docs' }] }],
};
const DOCS = 'https://docs.example.com';

type Posted = { message: { type: string; nonce?: string; reason?: string; requestId?: string }; origin: string };

/** A fake app window: an opener that records what it's sent, a location. */
function appWindow(search: string, opener: { postMessage: (m: unknown, o: string) => void } | null) {
  const target = new EventTarget();
  const store = new Map<string, string>();
  return Object.assign(target, {
    location: { href: `https://app.example.com/${search}` },
    history: { state: null, replaceState: vi.fn() },
    opener,
    top: null as unknown,
    self: null as unknown,
    crypto: globalThis.crypto,
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
}

function setup(search = `?etb=1&etbFrom=${encodeURIComponent(DOCS)}`) {
  const posted: Posted[] = [];
  const opener = { postMessage: (message: unknown, origin: string) => posted.push({ message: message as Posted['message'], origin }) };
  const win = appWindow(search, opener);
  win.top = win;
  win.self = win;
  const receiver = acceptRemoteTutorials({ kit, allowedOrigins: [DOCS], win: win as unknown as Window, readyIntervalMs: 100 });
  // jsdom's MessageEvent can't take a plain object as `source`: patch it in.
  const deliver = (data: unknown, origin = DOCS, source: unknown = opener) => {
    const event = new MessageEvent('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    win.dispatchEvent(event);
  };
  return { posted, receiver, deliver, win, opener };
}

afterEach(() => vi.useRealTimers());

describe('acceptRemoteTutorials (the app)', () => {
  it('speaks first: ready → start → queued request → consent → accepted', () => {
    vi.useFakeTimers();
    const { posted, receiver, deliver, win } = setup();
    expect(posted[0]).toMatchObject({ message: { type: 'etb:ready' }, origin: DOCS });
    vi.advanceTimersByTime(250);
    expect(posted.filter((p) => p.message.type === 'etb:ready').length).toBeGreaterThan(1); // repeated
    expect(win.history.replaceState).toHaveBeenCalled(); // params stripped
    const nonce = posted[0].message.nonce!;
    const seen = vi.fn();
    receiver.onRequest(seen);
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'r1', script: JSON.stringify(script) });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', origin: DOCS }));
    expect(receiver.pending()?.tutorial.id).toBe('remote-demo');
    const readies = posted.length;
    vi.advanceTimersByTime(1000);
    expect(posted.length).toBe(readies); // ready stops once answered
    receiver.respond('r1', 'accept');
    expect(posted.at(-1)).toMatchObject({ message: { type: 'etb:accepted', requestId: 'r1' }, origin: DOCS });
    expect(receiver.pending()).toBeNull();
    receiver.dispose();
  });

  it('ignores the wrong origin, the wrong window and the wrong nonce', () => {
    const { posted, receiver, deliver } = setup();
    const nonce = posted[0].message.nonce!;
    const seen = vi.fn();
    receiver.onRequest(seen);
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'x', script: JSON.stringify(script) }, 'https://evil.example');
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'x', script: JSON.stringify(script) }, DOCS, {});
    deliver({ type: 'etb:start', protocol: 1, nonce: 'guess', requestId: 'x', script: JSON.stringify(script) });
    expect(seen).not.toHaveBeenCalled();
    receiver.dispose();
  });

  it('rejects invalid, oversized, incapable and repeated requests with a reason', () => {
    const { posted, receiver, deliver } = setup();
    const nonce = posted[0].message.nonce!;
    const reasons = () => posted.filter((p) => p.message.type === 'etb:rejected').map((p) => p.message.reason);
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'a', script: '{"format":1}' });
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'b', script: 'x'.repeat(600_000) });
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'c', script: JSON.stringify({ ...script, requires: ['warp'] }) });
    deliver({ type: 'etb:start', protocol: 9, nonce, requestId: 'd', script: JSON.stringify(script) });
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'e', script: JSON.stringify(script) });
    deliver({ type: 'etb:start', protocol: 1, nonce, requestId: 'f', script: JSON.stringify(script) });
    expect(reasons()).toEqual(['invalid', 'too-large', 'capability', 'protocol', 'already-handled']);
    receiver.dispose();
  });

  it('does nothing without the handshake params, an allowed origin, or an opener', () => {
    expect(setup('').posted).toHaveLength(0);
    expect(setup(`?etb=1&etbFrom=${encodeURIComponent('https://evil.example')}`).posted).toHaveLength(0);
    const win = appWindow(`?etb=1&etbFrom=${encodeURIComponent(DOCS)}`, null);
    win.top = win;
    win.self = win;
    const receiver = acceptRemoteTutorials({ kit, allowedOrigins: [DOCS], win: win as unknown as Window });
    expect(receiver.pending()).toBeNull();
  });

  it('refuses inside a frame', () => {
    const posted: Posted[] = [];
    const win = appWindow(`?etb=1&etbFrom=${encodeURIComponent(DOCS)}`, { postMessage: (m, o) => posted.push({ message: m as Posted['message'], origin: o }) });
    win.top = {};
    win.self = win;
    acceptRemoteTutorials({ kit, allowedOrigins: [DOCS], win: win as unknown as Window });
    expect(posted).toHaveLength(0);
  });
});

describe('launchTutorial (the docs site)', () => {
  it('opens a new tab, answers ready with the script, and resolves on accepted', async () => {
    const docs = new EventTarget() as EventTarget & Window;
    const sent: { message: { type: string; nonce: string; script: string }; origin: string }[] = [];
    const app = { closed: false, postMessage: (message: never, origin: string) => sent.push({ message, origin }) };
    Object.assign(docs, { location: { href: `${DOCS}/guide`, origin: DOCS }, open: vi.fn(() => app) });
    const result = launchTutorial({ appUrl: 'https://app.example.com/', script, win: docs, requestId: 'docs-1' });
    const opened = (docs.open as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opened[1]).toBe('_blank');
    expect(String(opened[0])).toContain(`etbFrom=${encodeURIComponent(DOCS)}`);
    const deliver = (data: unknown) => {
      const event = new MessageEvent('message', { data, origin: 'https://app.example.com' });
      Object.defineProperty(event, 'source', { value: app });
      docs.dispatchEvent(event);
    };
    deliver({ type: 'etb:ready', protocol: 1, nonce: 'n1' });
    expect(sent[0]).toMatchObject({ origin: 'https://app.example.com', message: { type: 'etb:start', nonce: 'n1' } });
    expect(JSON.parse(sent[0].message.script).id).toBe('remote-demo');
    deliver({ type: 'etb:accepted', requestId: 'docs-1' });
    await expect(result).resolves.toEqual({ status: 'accepted' });
  });

  it('reports a blocked popup', async () => {
    const docs = new EventTarget() as EventTarget & Window;
    Object.assign(docs, { location: { href: DOCS, origin: DOCS }, open: () => null });
    await expect(launchTutorial({ appUrl: 'https://app.example.com/', script, win: docs })).resolves.toEqual({ status: 'blocked' });
  });
});
