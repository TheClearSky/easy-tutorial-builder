# @theclearsky/easy-tutorial-builder

Interactive, fault-tolerant product tours written as **typed, data-only scripts**.

- **Steps advance on what the user actually does.** A step waits for an app event (`"demo.loaded"`), not a Next button.
- **Distractions route back.** "The menu closed → go back to 'open the menu'" is an ordinary transition in the script.
- **Follows moving targets.** Targets are re-found every frame, so the spotlight keeps up with pan/zoom canvases (ReactFlow), re-mounted elements, portals and scrolling.
- **Task clicks get through.** The spotlight can cut several holes, so a submenu that opens outside the highlight stays clickable.
- **Scripts can't run code.** They only name things your app registered, which makes a script safe to load from a docs site or another tab.
- **Your own guide renders the steps.** The library draws only the spotlight; your speaker (a mascot, a bubble, anything) gets everything it needs from `getView()`.
- **Remote launch built in.** A docs site can open your app in a new tab and hand it a tutorial over `postMessage`, with an exact-origin allow-list and user consent.

The inspiration: the typed step model and failure reporting of [React Joyride](https://github.com/gilbarbara/react-joyride), and the framework-free, imperative control of [driver.js](https://github.com/nilbuild/driver.js).

MIT. Core ~5 KB gzip, with no dependencies. `react` and `zod` are optional peers.

## Install

```sh
npm install @theclearsky/easy-tutorial-builder
# optional: zod for ./schema and ./remote, react for ./react
```

## 1. Describe your app: a kit

```ts
import { byTourId, defineKit } from '@theclearsky/easy-tutorial-builder';

export const kit = defineKit({
  targets: {
    'toolbar.demos': () => byTourId('toolbar.demos'), // <button data-tour="toolbar.demos">
    'menu.item': ({ id }) => document.querySelector(`[data-menu-item="${id}"]`),
  },
  events: ['menu.opened', 'menu.closed', 'demo.loaded'],
  predicates: { menuOpen: () => !!document.querySelector('[role=menu]') },
  assists: { openMenu: () => document.querySelector<HTMLElement>('[data-tour="toolbar.demos"]')?.click() },
  capabilities: ['demosMenu'],
});

// Anywhere in your app, whether or not a tutorial is running:
kit.bus.emit('demo.loaded', { id: 'piano' });
```

## 2. Write a tutorial: data only

```json
{
  "format": 1,
  "id": "open-piano",
  "revision": 1,
  "title": "Open the piano",
  "requires": ["demosMenu"],
  "steps": [
    { "id": "demos", "type": "point", "target": { "name": "toolbar.demos" },
      "skipIf": { "pred": "menuOpen" },
      "lines": [{ "say": "Click **Demos**.", "mood": "pointing" }],
      "advance": [{ "on": { "event": "menu.opened" }, "goto": "next" }],
      "timeoutMs": 12000, "hint": [{ "say": "It's the purple button." }],
      "assist": { "name": "openMenu", "label": "Show me" } },
    { "id": "piano", "type": "point", "target": { "name": "menu.item", "args": { "id": "piano" } },
      "lines": [{ "say": "Now pick **Piano**." }],
      "advance": [
        { "on": { "event": "demo.loaded", "args": { "id": "piano" } }, "goto": "next" },
        { "on": { "event": "menu.closed" }, "goto": "demos" }
      ] },
    { "id": "done", "type": "end", "lines": [{ "say": "That's it!", "mood": "celebrate" }] }
  ]
}
```

The step types are `say` (the user presses Next), `point` (wait for an action), `choice`, `branch` and `end`. Conditions are `{pred}`, `{not}`, `{all}` and `{any}`, with no expressions. In TypeScript, `defineTutorial(kit, {...})` turns an unknown name into a type error. For JSON files, `tutorialJsonSchema(kit)` gives editors autocompletion.

## 3. Run it

```ts
import { createProgressStore, createTutorial } from '@theclearsky/easy-tutorial-builder';
import { parseTutorial } from '@theclearsky/easy-tutorial-builder/schema';

const parsed = parseTutorial(kit, jsonText, { maxBytes: 512_000 });
if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join('\n'));

const tour = createTutorial({ kit, tutorial: parsed.tutorial, progress: createProgressStore(localStorage) });
tour.subscribe(() => renderMyGuide(tour.getView())); // lines, mood, target rect, buttons
tour.on('failure', (failure) => console.warn(failure)); // target_not_found, assist_failed, …
tour.start(); // or tour.resume() from the last checkpoint
```

With React: `<TutorialProvider kit={kit}>` and `const { view, start, controller } = useTutorial()` from `@theclearsky/easy-tutorial-builder/react`.

To spotlight a single element with no tour: `highlight(() => byTourId('save'))`.

## 4. Launch from another tab (a docs site)

```ts
// the app, in the FIRST module that runs (before any UI):
import { acceptRemoteTutorials } from '@theclearsky/easy-tutorial-builder/remote';
const remote = acceptRemoteTutorials({ kit, allowedOrigins: ['https://docs.example.com'] });
remote.onRequest((request) => askTheUser(request).then((yes) =>
  remote.respond(request.requestId, yes ? 'accept' : { reject: 'declined' })));

// the docs site, inside a click handler:
import { launchTutorial } from '@theclearsky/easy-tutorial-builder/remote';
const result = await launchTutorial({ appUrl: 'https://app.example.com/', script });
// → accepted | rejected{reason} | blocked | no-opener | closed | timeout
```

**The app speaks first.** It announces `ready` only after its listener is installed, and repeats it. The docs site listens before it opens the app and only ever replies. So no message is ever sent to a listener that doesn't exist yet.

The receiver's checks:
- the sender's origin exactly matches the allow-list, and the sender is the window that opened the app (`event.source`);
- a one-time nonce, and one request per page load, within a 60 s window;
- the size is checked before parsing (512 KB by default);
- the script passes schema validation and the app has every capability it requires;
- remote launch is refused when the app is inside a frame;
- the request is queued in `sessionStorage`, so it survives reloads and a "click to start" gate.

The app only ever sends back `ready`, `accepted` or `rejected` plus a reason code.

## License

MIT © 2026 Deepak Prasad
