# Friend 9's room

A small, lived-in corner of the internet for a professor who also has a life.
Friend 9 is a playful fictional character, not a biography of a real person.

The room is an **unlisted Easter egg**. Do not add it to the itsvibed Router's
cards, navigation, routing mark, or sitemap.

## A life in nine little things

Friend 9 takes scenic bicycle rides, repairs things for friends, keeps the
uneven mug, and shares the furniture with Crumb. Explore the window,
postcards, basil, radio, lamp, tea tray, mystery book, mending basket, and cat.
Their stories connect; making tea, repairing a sock, or changing the weather
also changes the illustration and later conversation.

Each story starts with a short glance. **One more thing** opens the deeper
connection instead of putting the whole story on screen at once. Six extra
scraps live in the bookshelf, biscuit tin, map, drawer, bicycle and door
number. They are optional; they do not add another completion counter.
The book's pencil objections lead directly into the drawer and are actually
there beside Jo's repair note. The introductory companion aside is shown
once; conversation stays available without repeating it after every story.

The fridge is an interactive set of afternoon choices, not a pretend task
manager. Check or uncheck the scenic route, packing Jo's radio, and using the
wonky mug. The connected stories, resident's replies and illustrated props
follow those choices. Packing means ready for pickup, not already returned.
Pinning a postcard offers **Unpin this one** on the next click. Bookmarking
and stitching can be reversed too; watering remains a once-per-visit action.

Find nine distinct objects to open the Sunday envelope. Sound is optional
and never required to finish. The radio has three original procedural tunes,
starts only on request, and stops when its tab is hidden. There are no timers,
scores, deadlines, or penalties. The `9` key introduces Crumb.
Header and notebook use the same Play/Pause radio action. Returning to a
paused radio explains what happened without restarting sound. The sealed
envelope can show what remains to discover before it can be opened.

Reading size, contrast, and reduced motion are independent settings. The
device's reduced-motion preference is always respected. On small screens,
the same object buttons become a labeled tray rather than tiny hotspots.
Discovery state and preferences use only the `friend9.room.v1` storage key.
Its version-two payload preserves old version-one discoveries and reading
preferences. Starting a fresh visit asks before clearing this room's state
and retains reading settings and theme. Text is deliberately non-selectable
throughout this illustrated page; native controls remain keyboard-accessible.
If JavaScript is unavailable, an accessible explanation precedes the room
controls. A storage failure explains that new choices will not survive a
reload rather than merely reporting a technical saving problem.

The artwork itself accepts the same actions as the visible buttons. SVG
geometry IDs are therefore interaction anchors, not arbitrary labels. Keep
`sceneObjects`/`sceneScraps`, numbered hotspot positions, and the geometry
checks aligned when moving or renaming an item. Crumb's marker follows the
cat between rug and chair; the keyboard and mobile controls stay the same.

## Visit and run

- Share: `https://itsvibed.com/friend9s-room`
- Canonical page: `https://itsvibed.com/public/friend9s-room`
- `www.itsvibed.com` supports the same paths.

Node 22.18 or newer is the only runtime dependency. No package installation,
framework build, database, credentials, or other running project is needed.

```powershell
npm start
# http://127.0.0.1:3009/public/friend9s-room

npm run check
npm test

# For browser development only:
npm ci --ignore-scripts
npm run test:browser
```

The server binds **only to loopback**. `PORT` can select another development
port without stopping any sibling project. The Playwright check uses a fresh
headless Chrome process and isolated contexts; it never attaches to the
user's browser. Playwright is a pinned development-only dependency, not a
runtime or VM requirement. Set
`BROWSER_PATH` if Chrome is installed elsewhere and `ARTIFACT_DIR` to choose
where screenshots and per-journey evidence are written. `ROOM_ORIGIN` selects
the local or live site. `ROOM_SCENARIOS` accepts comma-separated journey IDs
such as `03-reversible-choices,04-little-plans` for focused checks.

Each journey records the actual served asset ETags, screenshots, accessible
content and a Playwright trace. The radio's real tab-hiding check uses a
separate owned Chrome profile through Playwright's `noDefaults` CDP option:
ordinary Playwright page setup forces focus, which otherwise masks actual
background-tab behavior. It never changes the user's browser or fakes
`document.hidden`.

Public files are read once at startup. After editing, restart only this
project's server; there is no framework cache or live build directory.

## UI borrowed, personality made here

These are native adaptations of actual sibling UI, not copied application
logic. The original SVG illustration, characters, stories, and audio sketches
are specific to this room.

| Source in Downloads | Adaptation |
|---|---|
| `Gurukul-Testing/src/components/ui/Button.tsx` and `src/app/globals.css` | Equal border geometry, paired button tokens, disabled guards, 120ms press response and smooth easing, adapted into this room's raised, rounded paper buttons |
| `Restaurant/app/src/components/ui/Checkbox.tsx` | A native checkbox wrapped by its complete clickable label |
| `Restaurant/app/src/app/globals.css` | Warm `#faf6ee` paper and `#2b2320` ink as the starting surface vocabulary |
| `Router/public/index.html` | Native, zero-dependency page structure and immediate three-pixel keyboard focus outlines |

The settings disclosure and native dialogs preserve the siblings' grouped
controls, Escape dismissal, focus restoration, and outside-press behavior
without importing React, Next, Tailwind, or their admin/session code.
The room changes CSS data attributes; it does not copy a theme helper that
injects styles, because that would violate this page's stricter CSP.

## Layout

| File | Owns |
|---|---|
| `public/index.html` | Accessible page structure and native dialogs |
| `public/room.css` | Shared tokens, room composition, themes and motion |
| `public/room.js` | The resident, discoveries and browser-only interactions |
| `public/room-content.js` | Canonical fictional lore and pure story/choice branches |
| `public/room-state.js` | Versioned local-state validation, migration and reversible choices |
| `public/room.svg` | Original room illustration |
| `public/favicon.svg` | Original door-number icon |
| `server.mjs` | Exact static routes, redirect and HTTP protections |
| `test/server.test.mjs` | Built-in Node HTTP contract tests |
| `test/room-state.test.mjs` | Native state migration, persistence-shape and toggle tests |
| `scripts/playwright-check.mjs` | Ten real-browser journeys, screenshots and assertions |
| `scripts/room-browser.mjs` | Isolated Playwright launch and evidence helpers |
| `deploy/` | Resource-limited system service and guarded first installation |

## Safety boundary

There are no accounts, forms, uploads, admin pages, server-side visitor state,
analytics, remote embeds, or third-party runtime requests. Room interactions
do not call an API. Sound is synthesized locally and only starts after a
visitor asks for it.

Only the seven named public files are served. Request paths are never passed
to filesystem APIs, unknown routes stay 404, and only GET/HEAD are accepted.
Browser protections include a CSP without inline scripts/styles or eval,
disabled framing, no-referrer, same-origin resources, disabled sensitive
device permissions, and noindex/nofollow. The noindex directive is a request
to crawlers, **not access control**; anyone with the URL can visit.

The room shares an origin with existing itsvibed apps. A URL path is not a
browser security boundary. Keep this app free of user-supplied HTML, scripts,
third-party widgets, authentication, and sensitive storage.

Responses use `Cache-Control: no-transform`. Without it, the shared
Cloudflare zone adds an analytics beacon and inline JavaScript Detections
code, both correctly refused by this page's CSP. Cloudflare documents that
`no-transform` prevents both injections: [Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)
and [JavaScript Detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/).
This keeps the room's delivered code intact without allowing inline scripts
or third-party tracking. It changes no zone-wide firewall settings; the
room has no account or write endpoint depending on a JavaScript Detections
signal. Other apps keep their own response policies.

The VM service has a dynamic unprivileged identity, read-only filesystem,
no home-directory access, no capabilities, and memory/CPU/process limits.
It cannot read the other apps' private files or take over their ports.
Deployment and routing details are in [DEPLOY.md](DEPLOY.md).
