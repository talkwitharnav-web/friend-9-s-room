import {
  STORAGE_KEY, OBJECT_IDS, PLAN_IDS, SCRAP_IDS, freshState, readStoredState,
  resetDiscoveries, togglePin,
} from "./room-state.js";
import {
  OBJECT_LABELS, TRACKS, getStory, getScrap, planReaction, residentLine, getLetter,
} from "./room-content.js";

const root = document.documentElement;
const byId = (id) => document.getElementById(id);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const objectIds = OBJECT_IDS;
const tracks = TRACKS;
const prefersEvening = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const initialState = () => freshState(prefersEvening());

function storageNotice(message, error) {
  byId("storage-notice").hidden = false;
  byId("storage-notice").textContent = message;
  if (error) console.warn("[friend9] Room storage unavailable:", error.name);
}

function expectedStorageError(error) {
  return error instanceof DOMException &&
    ["SecurityError", "QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name);
}

function restoreState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    if (!expectedStorageError(error)) throw error;
    storageNotice("Your choices work for this visit, but this browser won't remember new ones after a reload.", error);
    return initialState();
  }
  const result = readStoredState(raw, prefersEvening());
  if (result.notice) storageNotice(result.notice);
  return result.state;
}

let state = restoreState();
let selectedObject = null;
let lastHotspot = null;
let noteResult = "";
let selectedScrap = "shelf";
let activePrompt = null;
let conversationTurn = 0;
let lastPlan = null;
let noticeTimer;
let audioContext = null;
let audioMaster = null;
let audioTimer;
let audioBusy = false;
let soundWanted = false;
let audioPausedAway = false;
const activeNotes = new Set();
const sceneObjects = new Map(Object.entries({
  window: "window", "curtains-left": "window", "curtains-right": "window", "curtain-rod": "window",
  postcard: "postcards", "bakery-postcard": "postcards", basil: "plant", radio: "radio",
  lamp: "lamp", tea: "tea", "shelf-mug": "tea", "resident-book": "book", "repair-basket": "mending",
  "cat-on-rug": "cat", "cat-on-chair": "cat",
}));
const sceneScraps = new Map(Object.entries({
  bookshelf: "shelf", "biscuit-tin": "tin", "route-map": "map", "table-drawer": "drawer",
  bicycle: "bicycle", "bakery-order-slip": "nine", "bakery-chair-nine": "nine",
}));

function selectIllustration(event) {
  const artwork = event.currentTarget;
  let element = event.target instanceof Element ? event.target : null;
  while (element && element !== artwork) {
    const object = sceneObjects.get(element.id);
    const scrap = sceneScraps.get(element.id);
    if (object) {
      document.querySelector(`button[data-object="${object}"]`).focus({ preventScroll: true });
      selectObject(object, { moveToNote: true });
      return;
    }
    if (scrap) {
      document.querySelector(`button[data-scrap="${scrap}"]`).focus({ preventScroll: true });
      showScrap(scrap);
      return;
    }
    element = element.parentElement;
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    byId("storage-notice").hidden = true;
  } catch (error) {
    if (!expectedStorageError(error)) throw error;
    storageNotice("Keep exploring. This browser couldn't save your new choices, so they won't be remembered after a reload.", error);
  }
}

function announce(message, visible = false) {
  clearTimeout(noticeTimer);
  byId("room-status").textContent = message;
  byId("room-status").dataset.visible = String(visible);
  if (visible) noticeTimer = setTimeout(() => { byId("room-status").dataset.visible = "false"; }, 6000);
}

function discover(id) {
  if (state.seen.includes(id)) return false;
  state.seen.push(id);
  persistState();
  return state.seen.length === 9;
}

function changeState(changes, message, { showInStory = true } = {}) {
  Object.assign(state, changes);
  noteResult = showInStory ? message : "";
  persistState();
  render();
  announce(message);
}

function roomAction(id, label, run, options = {}) {
  return { id, label, run, ...options };
}

function storyFields(id) {
  return {
    label: OBJECT_LABELS[id],
    title: () => getStory(id, state).title,
    story: () => getStory(id, state).glance,
    extra: () => getStory(id, state).detail,
  };
}

const objects = {
  window: {
    ...storyFields("window"),
    actions: () => [
      roomAction("sun", "Sunshine", () => changeState({ weather: "sun" }, "A good day for the garden path."), { pressed: state.weather === "sun", icon: "sun" }),
      roomAction("rain", "Drizzle", () => changeState({ weather: "rain" }, "The umbrella has been promoted."), { pressed: state.weather === "rain", icon: "rain" }),
    ],
  },
  postcards: {
    ...storyFields("postcards"),
    actions: () => [
      roomAction("turn", "Next postcard", () => changeState({ postcard: (state.postcard + 1) % 3 }, "Another little detour."), { icon: "postcards" }),
      roomAction("pin", state.pinnedPostcard === state.postcard ? "Unpin this one" : "Pin this one", () => {
        const movingPin = state.pinnedPostcard !== null && state.pinnedPostcard !== state.postcard;
        const pinnedPostcard = togglePin(state);
        changeState({ pinnedPostcard }, pinnedPostcard === null ? "Back in the little stack." :
          movingPin ? "Moved the pin here. The other card is back in the stack." : "A favorite, up on the wall.");
      }, { pressed: state.pinnedPostcard === state.postcard, icon: "pin" }),
    ],
  },
  plant: {
    ...storyFields("plant"),
    actions: () => [
      roomAction("water", state.watered ? "Watered for now" : "A sip for the basil", () => changeState({ watered: true }, "Leaves up. A small success."), { disabled: state.watered, icon: "water" }),
    ],
  },
  radio: {
    ...storyFields("radio"),
    actions: () => [
      roomAction("sound", "Play the radio", () => { void setSound(!soundWanted); }, { sound: true, icon: "radio" }),
      roomAction("station", "Next station", () => {
        const track = (state.track + 1) % tracks.length;
        changeState({ track }, `The dial says "${tracks[track]}."`);
        if (soundWanted) restartMelody();
      }, { icon: "next" }),
    ],
  },
  lamp: {
    ...storyFields("lamp"),
    actions: () => [
      roomAction("day", "Afternoon", () => changeState({ theme: "day" }, "A little daylight."), { pressed: state.theme === "day", icon: "sun" }),
      roomAction("evening", "Lamplight", () => changeState({ theme: "evening" }, "The little lamp is on."), { pressed: state.theme === "evening", icon: "lamp" }),
    ],
  },
  tea: {
    ...storyFields("tea"),
    actions: () => [
      roomAction("mint", "Mint, please", () => changeState({ tea: "mint" }, "Mint for two. Yours is the yellow cup."), { pressed: state.tea === "mint", icon: "plant" }),
      roomAction("ginger", "Ginger, please", () => changeState({ tea: "ginger" }, "Ginger for two. A little extra warmth."), { pressed: state.tea === "ginger", icon: "tea" }),
    ],
  },
  book: {
    ...storyFields("book"),
    actions: () => [
      roomAction("read", state.bookmarked ? "Remove bookmark" : "Mark this page", () => changeState({ bookmarked: !state.bookmarked }, state.bookmarked ? "Page corner smoothed. Bookmark out." : "The bookmark is in."), { pressed: state.bookmarked, icon: "book" }),
    ],
  },
  mending: {
    ...storyFields("mending"),
    actions: () => [
      roomAction("stitch", state.mended ? "Undo the stitch" : "Add a red stitch", () => changeState({ mended: !state.mended }, state.mended ? "Thread pulled gently back out." : "One bright stitch. Quite proud of that."), { pressed: state.mended, icon: "mending" }),
    ],
  },
  cat: {
    ...storyFields("cat"),
    actions: () => [
      roomAction("chair", state.cat === "chair" ? "Back to the rug" : "Offer the chair", () => {
        const cat = state.cat === "chair" ? "rug" : "chair";
        changeState({ cat }, cat === "chair" ? "Chair accepted. You may carry on." : "Back on the rug, with dignity.");
      }, { icon: "cat" }),
    ],
  },
};

const iconPaths = {
  sun: ["M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z", "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"],
  rain: ["M6 14a4 4 0 0 1-1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9", "m7 17-1 3m6-3-1 3m6-3-1 3"],
  window: ["M4 21V8a8 8 0 0 1 16 0v13ZM12 2v19M4 12h16M2 21h20"],
  postcards: ["m3 5 17-2 2 16-17 2Z", "m7 15 3-5 4 3 3-4 2 5M8 7h1"],
  pin: ["m9 3 8 3-3 3-1 5-7-2 4-3-1-6Zm0 11-4 7"],
  plant: ["M8 16h9l-1 6H9Z", "M12 16V5m0 7C3 12 3 4 12 8m1 1c0-8 9-8 7-3-1 3-4 4-7 3"],
  water: ["M12 2C10 7 5 10 5 15a7 7 0 0 0 14 0c0-5-5-8-7-13ZM8 15c0 3 2 4 4 4"],
  radio: ["M3 7h18v14H3ZM6 7V4l11-2M6 11v6m3-6v6m3-6v6M16 11h2", "M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"],
  next: ["m5 5 9 7-9 7V5ZM19 5v14"],
  lamp: ["M8 3h8l4 10H4ZM12 13v8m-4 0h8M18 14v4"],
  tea: ["M4 9h13v8c0 7-13 7-13 0V9Zm13 2h2c5 0 5 7-2 7M7 5c-2-2 2-3 0-5m6 5c-2-2 2-3 0-5"],
  book: ["M3 3c4-1 7 0 9 2 2-2 5-3 9-2v16c-4-1-7 0-9 2-2-2-5-3-9-2V3ZM12 5v16M7 7v6l2-2 2 2V7"],
  mending: ["M8 2h8v11l4 4c3 4-2 7-5 4l-8-6ZM8 5h8M9 12l5 4m-5 0 5-4"],
  cat: ["M5 10 3 3l6 4c2-1 4-1 6 0l6-4-2 8c5 12-19 13-14-1Z", "m7 12 2 1m6 0 2-1m-6 4 1 1 1-1M6 16H2m16 0h4"],
  shelf: ["M3 2h18v20H3ZM3 12h18M6 5v7m4-8v8m5-7 2 7M6 16h6v6m3-5h3v5"],
  tin: ["M4 6c0-4 16-4 16 0v13c0 4-16 4-16 0V6Zm0 0c0 4 16 4 16 0M8 13h8m-6 4h4"],
  map: ["m2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3V5ZM8 2v17M16 5v17", "M5 11c3-5 8 8 14-2"],
  drawer: ["M3 4h18v17H3ZM3 10h18M9 15h6M5 21v2m14-2v2"],
  bicycle: ["M5 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm14 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "m5 17 4-9 5 9H5l12-9 2 9M7 8h5m4-4h2l-1 4"],
  nine: ["M16 12V7c0-7-10-7-10 0v3c0 6 10 6 10 0m0 2c0 7-2 10-8 10"],
};

function makeIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of iconPaths[name] ?? iconPaths.tea) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function renderNotebook() {
  if (!selectedObject) return;
  const object = objects[selectedObject];
  const story = getStory(selectedObject, state);
  const focusedAction = document.activeElement?.dataset.action;
  const hadControlFocus = byId("note-actions").contains(document.activeElement);
  byId("note-kicker").textContent = object.label.toUpperCase();
  byId("note-number").textContent = selectedObject === "postcards"
    ? `${state.postcard + 1} / 3`
    : String(objectIds.indexOf(selectedObject) + 1).padStart(2, "0");
  byId("note-title").textContent = object.title();
  byId("note-body").textContent = object.story();
  byId("station-label").hidden = selectedObject !== "radio";
  byId("station-label").textContent = `Sunday FM: ${tracks[state.track]}`;
  byId("note-extra").textContent = object.extra();
  byId("note-result").textContent = noteResult;
  byId("note-doodle").replaceChildren(makeIcon(selectedObject));
  byId("note-more").hidden = false;
  byId("story-link").textContent = story.link;
  byId("story-link").dataset.destination = story.related;
  byId("note-navigation").hidden = false;
  const controls = object.actions().map((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.dataset.action = action.id;
    const label = document.createElement("span");
    label.className = "button-label";
    label.textContent = action.label;
    if (action.icon) button.append(makeIcon(action.icon));
    button.append(label);
    button.disabled = action.disabled ?? false;
    if (action.pressed !== undefined) button.setAttribute("aria-pressed", String(action.pressed));
    if (action.sound) button.dataset.soundControl = "true";
    button.addEventListener("click", action.run);
    return button;
  });
  byId("note-actions").replaceChildren(...controls);
  if (hadControlFocus) {
    const replacement = controls.find((button) => button.dataset.action === focusedAction && !button.disabled);
    (replacement ?? byId("note-title")).focus({ preventScroll: true });
  }
}

function render() {
  root.dataset.theme = state.theme;
  root.dataset.weather = state.weather;
  root.dataset.tea = state.tea;
  root.dataset.watered = String(state.watered);
  root.dataset.mended = String(state.mended);
  root.dataset.cat = state.cat;
  root.dataset.postcard = String(state.postcard);
  root.dataset.pinned = String(state.pinnedPostcard === state.postcard);
  root.dataset.bookmarked = String(state.bookmarked);
  root.dataset.track = String(state.track);
  root.dataset.reducedMotion = String(state.reducedMotion || motionPreference.matches);
  root.dataset.largeText = String(state.largeText);
  root.dataset.contrast = String(state.contrast);
  root.dataset.route = state.plans.scenic ? "scenic" : "direct";
  root.dataset.radioPacked = String(state.plans.radio);
  root.dataset.mugKept = String(state.plans.mug);
  for (const input of document.querySelectorAll("[data-plan]")) {
    input.checked = state.plans[input.dataset.plan];
  }
  byId("plan-reaction").textContent = planReaction(lastPlan, state);
  byId("afternoon-caption").textContent = state.theme === "evening"
    ? (state.weather === "rain" ? "Rain at the window. Lamp on." : "The evening has settled in.")
    : (state.weather === "rain" ? "A rainy little afternoon." : "A little afternoon at home.");
  byId("lore-teaser").textContent = state.scraps.includes("nine")
    ? "A bakery table, a borrowed chair, and the things everyone left behind."
    : "A biscuit tin, a folded map, and a number that stuck.";
  byId("motion-toggle").checked = state.reducedMotion || motionPreference.matches;
  byId("motion-toggle").disabled = motionPreference.matches;
  byId("size-toggle").checked = state.largeText;
  byId("contrast-toggle").checked = state.contrast;
  byId("lamp-toggle").setAttribute("aria-pressed", String(state.theme === "evening"));
  byId("lamp-label").textContent = state.theme === "day" ? "Evening, please" : "A little daylight";
  byId("discovery-count").textContent = `${state.seen.length} / 9`;
  byId("discovery-toggle").setAttribute("aria-label", `${state.seen.length} of 9 little things discovered. Open the discovery list.`);
  for (const button of document.querySelectorAll("[data-object]")) {
    const id = button.dataset.object;
    const found = state.seen.includes(id);
    button.classList.toggle("is-found", found);
    button.setAttribute("aria-pressed", String(selectedObject === id));
    button.setAttribute("aria-controls", "notebook");
    button.setAttribute("aria-label", `${objects[id].label}${found ? ", discovered" : ", unexplored"}. Read its story.`);
    button.querySelector(".found-label").textContent = found ? "Discovered" : "";
    button.querySelector(".hotspot-dot").textContent = found ? "\u2713" : String(objectIds.indexOf(id) + 1);
  }
  const complete = state.seen.length === 9;
  byId("envelope-button").classList.toggle("is-ready", complete);
  byId("envelope-button").setAttribute("aria-label", complete
    ? "Open the Sunday envelope"
    : `The Sunday envelope. ${9 - state.seen.length} little things left to discover.`);
  byId("envelope-hint").textContent = complete
    ? "It's yours now. Go on, open it."
    : "See what's left to explore.";
  renderNotebook();
  byId("resident-reply").hidden = selectedObject !== null && activePrompt === null;
  if (activePrompt) renderResidentReply();
  if (byId("scraps-dialog").open) renderScrap();
  if (byId("letter-dialog").open) renderLetter();
  syncSoundControls();
}

function selectObject(id, { moveToNote = false } = {}) {
  if (selectedObject !== id) byId("note-more").open = false;
  selectedObject = id;
  lastHotspot = document.querySelector(`button[data-object="${id}"]`);
  noteResult = "";
  const finished = discover(id);
  render();
  announce(finished
    ? "Nine little things. The Sunday envelope is ready for you."
    : `${objects[id].label}. ${objects[id].title()}`);
  if (moveToNote && window.matchMedia("(max-width: 900px)").matches) {
    byId("note-title").focus({ preventScroll: true });
    byId("notebook").scrollIntoView({
      block: "start",
      behavior: root.dataset.reducedMotion === "true" ? "instant" : "smooth",
    });
  }
}

function followStory(destination) {
  if (OBJECT_IDS.includes(destination)) {
    if (byId("scraps-dialog").open) {
      dialogOpeners.set(byId("scraps-dialog"), byId("note-title"));
      byId("scraps-dialog").close();
    }
    lastHotspot = document.querySelector(`[data-object="${destination}"]`);
    selectObject(destination, { moveToNote: true });
    byId("note-title").focus({ preventScroll: true });
    byId("note-title").scrollIntoView({
      block: "nearest",
      behavior: root.dataset.reducedMotion === "true" ? "instant" : "smooth",
    });
  } else if (SCRAP_IDS.includes(destination)) {
    showScrap(destination);
  } else {
    throw new Error(`Unknown story connection: ${destination}`);
  }
}

function renderScrap() {
  const scrap = getScrap(selectedScrap, state);
  const locations = {
    shelf: "ON THE BOOKSHELF", tin: "IN THE BISCUIT TIN", map: "ON THE FOLDED MAP",
    drawer: "IN THE DRAWER", bicycle: "IN THE BICYCLE BASKET", nine: "THE OLD TEA ORDER",
  };
  byId("scrap-kicker").textContent = locations[selectedScrap];
  byId("scrap-title").textContent = scrap.title;
  byId("scrap-body").textContent = scrap.body;
  byId("scrap-reaction").textContent = scrap.reaction;
  byId("scrap-related").textContent = scrap.link;
  byId("scrap-related").dataset.destination = scrap.related;
  byId("scrap-position").textContent = `${SCRAP_IDS.indexOf(selectedScrap) + 1} / ${SCRAP_IDS.length}`;
  byId("scrap-doodle").replaceChildren(makeIcon(selectedScrap));
}

function showScrap(id) {
  selectedScrap = id;
  if (!state.scraps.includes(id)) {
    state.scraps.push(id);
    persistState();
  }
  render();
  renderScrap();
  if (!byId("scraps-dialog").open) openDialog(byId("scraps-dialog"));
  announce(getScrap(id, state).title);
}

function renderLetter() {
  const letter = getLetter(state);
  byId("letter-story").textContent = letter.story;
  byId("letter-plans").textContent = letter.plans;
}

function updateDiscoveries() {
  byId("discovery-list").replaceChildren(...objectIds.map((id, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const mark = document.createElement("span");
    mark.className = "list-mark";
    mark.textContent = state.seen.includes(id) ? "\u2713" : String(index + 1);
    mark.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = objects[id].label;
    button.setAttribute("aria-label", `${objects[id].label}, ${state.seen.includes(id) ? "discovered" : "still to explore"}`);
    button.append(mark, label);
    button.addEventListener("click", () => {
      dialogOpeners.set(byId("discoveries-dialog"), byId("note-title"));
      byId("discoveries-dialog").close();
      lastHotspot = document.querySelector(`[data-object="${id}"]`);
      selectObject(id, { moveToNote: true });
      byId("note-title").focus({ preventScroll: true });
    });
    return button;
  }));
}

const dialogOpeners = new WeakMap();
function openDialog(dialog) {
  dialogOpeners.set(dialog, document.activeElement);
  dialog.showModal();
}
for (const dialog of document.querySelectorAll("dialog")) {
  let pressedOutside = false;
  const outside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener("pointerdown", (event) => {
    pressedOutside = event.target === dialog && outside(event);
  });
  dialog.addEventListener("pointercancel", () => { pressedOutside = false; });
  dialog.addEventListener("click", (event) => {
    if (pressedOutside && event.target === dialog && outside(event)) dialog.close();
    pressedOutside = false;
  });
  dialog.addEventListener("close", () => {
    const opener = dialogOpeners.get(dialog);
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
  });
}
for (const button of document.querySelectorAll("[data-close]")) {
  button.addEventListener("click", () => byId(button.dataset.close).close());
}

function renderResidentReply() {
  const reply = residentLine(activePrompt, state, conversationTurn);
  byId("resident-reply").hidden = false;
  byId("resident-reply").textContent = `"${reply}"`;
  for (const button of document.querySelectorAll("[data-prompt]")) {
    button.setAttribute("aria-pressed", String(button.dataset.prompt === activePrompt));
  }
  return reply;
}

function residentReply(prompt) {
  if (prompt === activePrompt) conversationTurn++;
  else conversationTurn = 0;
  activePrompt = prompt;
  const reply = renderResidentReply();
  announce(`Friend 9: ${reply}`);
}

// Original, quiet six-note sketches. No recordings, lyrics, downloads or embeds.
const melodies = [
  [261.63, 329.63, 392, 293.66, 329.63, 220],
  [220, 261.63, 329.63, 392, 329.63, 293.66],
  [196, 246.94, 293.66, 369.99, 329.63, 246.94],
];
function scheduleMelody() {
  if (!audioContext || !audioMaster || audioContext.state !== "running") return;
  const context = audioContext;
  const start = context.currentTime + 0.05;
  melodies[state.track].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.44;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.3);
    oscillator.connect(gain);
    gain.connect(audioMaster);
    const note = { oscillator, gain };
    activeNotes.add(note);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      activeNotes.delete(note);
    };
    oscillator.start(at);
    oscillator.stop(at + 1.4);
  });
}

function syncSoundControls() {
  const playing = soundWanted && audioContext?.state === "running";
  root.dataset.sound = playing ? "on" : "off";
  const label = audioBusy ? "One moment..." : playing ? "Pause radio" : "Play radio";
  byId("sound-label").textContent = label;
  byId("sound-toggle").setAttribute("aria-pressed", String(playing));
  byId("sound-toggle").disabled = audioBusy;
  byId("radio-status").hidden = selectedObject !== "radio" || !audioPausedAway;
  for (const button of document.querySelectorAll("[data-sound-control]")) {
    button.querySelector(".button-label").textContent = label;
    button.disabled = audioBusy;
    button.setAttribute("aria-pressed", String(playing));
  }
}

function stopMelody() {
  clearInterval(audioTimer);
  for (const note of activeNotes) {
    note.oscillator.onended = null;
    note.oscillator.stop();
    note.oscillator.disconnect();
    note.gain.disconnect();
  }
  activeNotes.clear();
}

function restartMelody() {
  if (!soundWanted || audioContext?.state !== "running") return;
  stopMelody();
  scheduleMelody();
  audioTimer = setInterval(scheduleMelody, 3100);
}

async function closeSound() {
  stopMelody();
  const previous = audioContext;
  audioContext = null;
  audioMaster = null;
  if (previous && previous.state !== "closed") await previous.close();
}

async function setSound(enabled, reason = "manual") {
  const hadSound = soundWanted || audioContext !== null;
  if (reason === "away") {
    if (hadSound) audioPausedAway = true;
  } else {
    audioPausedAway = false;
  }
  soundWanted = enabled && !document.hidden;
  if (audioBusy) return; // Hidden-tab cancellation is consumed after resume below.
  audioBusy = true;
  syncSoundControls();
  try {
    if (!soundWanted) {
      await closeSound();
      if (reason === "away" && hadSound) announce("Radio paused while you were away. Play radio to start again.");
      else if (reason === "manual" && hadSound) announce("The radio is paused.");
    } else if (!audioContext) {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) {
        soundWanted = false;
        announce("This browser can't play the radio. You can still explore its story.", true);
        return;
      }
      audioContext = new AudioContextClass();
      audioContext.addEventListener("statechange", syncSoundControls);
      await audioContext.resume();
      if (!soundWanted || document.hidden) {
        await closeSound();
        if (audioPausedAway) announce("Radio paused while you were away. Play radio to start again.");
      } else {
        audioMaster = audioContext.createGain();
        audioMaster.gain.value = 0.16;
        audioMaster.connect(audioContext.destination);
        scheduleMelody();
        audioTimer = setInterval(scheduleMelody, 3100);
        discover("radio");
        render();
        announce(`A little "${tracks[state.track]}." The sound stops when you leave this tab.`);
      }
    }
  } catch (error) {
    soundWanted = false;
    await closeSound();
    if (!(error instanceof DOMException) ||
        !["NotAllowedError", "NotSupportedError", "InvalidStateError", "AbortError", "SecurityError"].includes(error.name)) {
      throw error;
    }
    console.warn("[friend9] Radio could not play:", error.name);
    announce("The radio couldn't start. Try pressing Play again.", true);
  } finally {
    audioBusy = false;
    syncSoundControls();
  }
}

document.querySelector(".artwork").addEventListener("click", selectIllustration);
for (const button of document.querySelectorAll("[data-interactive]")) button.disabled = false;
for (const button of document.querySelectorAll("[data-object]")) {
  button.addEventListener("click", () => {
    lastHotspot = button;
    selectObject(button.dataset.object, { moveToNote: true });
  });
}
for (const button of document.querySelectorAll("[data-prompt]")) {
  button.addEventListener("click", () => residentReply(button.dataset.prompt));
}
for (const button of document.querySelectorAll("[data-scrap]")) {
  button.addEventListener("click", () => showScrap(button.dataset.scrap));
}
for (const input of document.querySelectorAll("[data-plan]")) {
  input.addEventListener("change", () => {
    const id = input.dataset.plan;
    if (!PLAN_IDS.includes(id)) throw new Error(`Unknown little plan: ${id}`);
    lastPlan = id;
    activePrompt = `plan:${id}`;
    conversationTurn = 0;
    changeState({ plans: { ...state.plans, [id]: input.checked } },
      planReaction(id, { ...state, plans: { ...state.plans, [id]: input.checked } }), { showInStory: false });
  });
}
byId("story-link").addEventListener("click", (event) => followStory(event.currentTarget.dataset.destination));
byId("scrap-related").addEventListener("click", (event) => followStory(event.currentTarget.dataset.destination));
byId("previous-scrap").addEventListener("click", () => {
  showScrap(SCRAP_IDS[(SCRAP_IDS.indexOf(selectedScrap) + SCRAP_IDS.length - 1) % SCRAP_IDS.length]);
});
byId("next-scrap").addEventListener("click", () => {
  showScrap(SCRAP_IDS[(SCRAP_IDS.indexOf(selectedScrap) + 1) % SCRAP_IDS.length]);
});
byId("back-to-room").addEventListener("click", () => {
  const target = lastHotspot ?? document.querySelector("[data-object]");
  target.focus();
  target.scrollIntoView({ block: "center", behavior: "instant" });
});
byId("previous-object").addEventListener("click", () => {
  const index = objectIds.indexOf(selectedObject);
  selectObject(objectIds[(index + objectIds.length - 1) % objectIds.length]);
});
byId("next-object").addEventListener("click", () => {
  const index = objectIds.indexOf(selectedObject);
  selectObject(objectIds[(index + 1) % objectIds.length]);
});
byId("discovery-toggle").addEventListener("click", () => {
  updateDiscoveries();
  openDialog(byId("discoveries-dialog"));
});
byId("envelope-button").addEventListener("click", () => {
  if (state.seen.length === 9) {
    renderLetter();
    openDialog(byId("letter-dialog"));
  } else {
    updateDiscoveries();
    openDialog(byId("discoveries-dialog"));
  }
});
byId("lamp-toggle").addEventListener("click", () => {
  discover("lamp");
  changeState({ theme: state.theme === "day" ? "evening" : "day" },
    state.theme === "day" ? "Small lamp. Softer plans." : "There's still a little afternoon left.", { showInStory: false });
});
byId("sound-toggle").addEventListener("click", () => { void setSound(!soundWanted); });
byId("motion-toggle").addEventListener("change", (event) => changeState(
  { reducedMotion: event.target.checked }, event.target.checked ? "The room will keep still." : "A little movement is back.",
  { showInStory: false },
));
byId("size-toggle").addEventListener("change", (event) => changeState(
  { largeText: event.target.checked }, event.target.checked ? "A little easier on the eyes." : "Back to the usual text size.",
  { showInStory: false },
));
byId("contrast-toggle").addEventListener("change", (event) => changeState(
  { contrast: event.target.checked }, event.target.checked ? "A little more definition." : "Back to the softer outlines.",
  { showInStory: false },
));
byId("reset-visit").addEventListener("click", () => {
  openDialog(byId("reset-dialog"));
});
byId("confirm-reset").addEventListener("click", () => {
  byId("reset-dialog").close();
  state = resetDiscoveries(state, prefersEvening());
  selectedObject = null;
  noteResult = "";
  activePrompt = null;
  conversationTurn = 0;
  lastPlan = null;
  byId("note-kicker").textContent = "MAKE YOURSELF AT HOME";
  byId("note-number").textContent = "f9";
  byId("note-title").textContent = "Oh, hello again.";
  byId("note-body").textContent = "Same room. Fresh cup. Crumb would like you to know the chair is still under negotiation.";
  byId("note-result").textContent = "";
  byId("station-label").hidden = true;
  byId("note-more").hidden = true;
  byId("note-more").open = false;
  byId("note-doodle").replaceChildren(makeIcon("tea"));
  byId("resident-reply").textContent = '"Jo says I collect detours. I say a detour has never asked me to fix its printer."';
  for (const button of document.querySelectorAll("[data-prompt]")) button.setAttribute("aria-pressed", "false");
  byId("note-actions").replaceChildren();
  byId("note-navigation").hidden = true;
  persistState();
  render();
  void setSound(false, "reset");
  announce("A fresh visit. Your reading preferences stayed put.");
});
motionPreference.addEventListener("change", render);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void setSound(false, "away");
});
window.addEventListener("pagehide", () => { void setSound(false, "leaving"); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const settings = document.querySelector(".settings");
    if (settings.open && !document.querySelector("dialog[open]")) {
      settings.open = false;
      settings.querySelector("summary").focus();
    }
  }
  if (event.key !== "9" || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      document.querySelector("dialog[open]") ||
      event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
  lastHotspot = document.querySelector('[data-object="cat"]');
  selectObject("cat", { moveToNote: true });
});
document.addEventListener("pointerdown", (event) => {
  const settings = document.querySelector(".settings");
  if (settings.open && !settings.contains(event.target) && !document.querySelector("dialog[open]")) {
    settings.open = false;
  }
});
render();
byId("interaction-notice").hidden = true;
root.dataset.ready = "true";
