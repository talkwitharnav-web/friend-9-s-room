const STORAGE_KEY = "friend9.room.v1";
const root = document.documentElement;
const byId = (id) => document.getElementById(id);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const objectIds = ["window", "postcards", "plant", "radio", "lamp", "tea", "book", "mending", "cat"];
const postcardMemories = [
  {
    title: "The ferry we missed.",
    story: "We missed the ferry. Found the bakery. Called it even.",
    extra: "Jo wanted to wait for the next boat. I wanted to see where the little path went. We walked home. These are the socks I'm still repairing.",
  },
  {
    title: "A very good wrong turn.",
    story: "A bakery with three tables, no sign, and the best thing I've ever eaten out of a paper bag.",
    extra: "I drew a map on the back. It mostly says 'left at the interesting tree.' Jo has asked me not to give directions anymore.",
  },
  {
    title: "The scenic route.",
    story: "The bicycle ride was supposed to take twenty minutes. It took two hours. Nothing went wrong.",
    extra: "I stopped for a tree, a dog, and a bench with excellent judgment about where to be.",
  },
];
const tracks = ["Window seat", "Slow Sunday", "The scenic route"];
const initialState = () => ({
  version: 1,
  seen: [],
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "evening" : "day",
  weather: "sun",
  tea: "none",
  watered: false,
  mended: false,
  cat: "rug",
  postcard: 0,
  pinnedPostcard: null,
  bookmarked: false,
  track: 0,
  reducedMotion: false,
  largeText: false,
  contrast: false,
});

function storageNotice(message, error) {
  byId("storage-notice").hidden = false;
  byId("storage-notice").textContent = message;
  if (error) console.warn("[friend9] Room storage unavailable:", error.name);
}

function expectedStorageError(error) {
  return error instanceof DOMException &&
    ["SecurityError", "QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name);
}

function validState(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    value.version === 1 &&
    Array.isArray(value.seen) && value.seen.length <= 9 &&
    value.seen.every((id) => objectIds.includes(id)) &&
    new Set(value.seen).size === value.seen.length &&
    ["day", "evening"].includes(value.theme) &&
    ["sun", "rain"].includes(value.weather) &&
    ["none", "mint", "ginger"].includes(value.tea) &&
    ["rug", "chair"].includes(value.cat) &&
    [0, 1, 2].includes(value.postcard) &&
    [null, 0, 1, 2].includes(value.pinnedPostcard) &&
    [0, 1, 2].includes(value.track) &&
    ["watered", "mended", "bookmarked", "reducedMotion", "largeText", "contrast"]
      .every((key) => typeof value[key] === "boolean");
}

function restoreState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    if (!expectedStorageError(error)) throw error;
    storageNotice("Make yourself at home. This browser can't keep your discoveries after you leave.", error);
    return initialState();
  }
  if (raw === null) return initialState();
  let parsed;
  if (raw.length <= 4096) {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  if (!validState(parsed)) {
    storageNotice("The saved room settings couldn't be read, so this visit starts fresh.");
    return initialState();
  }
  // Copy only this version's known fields, never arbitrary stored properties.
  return Object.fromEntries(Object.keys(initialState()).map((key) => [key, parsed[key]]));
}

let state = restoreState();
let selectedObject = null;
let lastHotspot = null;
let noteResult = "";
let statusTimer;
let adviceIndex = 0;
let audioContext = null;
let audioMaster = null;
let audioTimer;
let audioBusy = false;
let soundWanted = false;
const activeNotes = new Set();

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    byId("storage-notice").hidden = true;
  } catch (error) {
    if (!expectedStorageError(error)) throw error;
    storageNotice("Your room still works. This browser couldn't save the latest discoveries.", error);
  }
}

function announce(message) {
  clearTimeout(statusTimer);
  byId("room-status").textContent = message;
  byId("room-status").dataset.visible = "true";
  statusTimer = setTimeout(() => {
    byId("room-status").dataset.visible = "false";
  }, 6500);
}

function discover(id) {
  if (state.seen.includes(id)) return false;
  state.seen.push(id);
  persistState();
  return state.seen.length === 9;
}

function changeState(changes, message) {
  Object.assign(state, changes);
  noteResult = message;
  persistState();
  render();
  announce(message);
}

function roomAction(id, label, run, options = {}) {
  return { id, label, run, ...options };
}

const objects = {
  window: {
    label: "The window",
    title: () => "The outside can wait.",
    story: () => "I go out for ten minutes and come back with a bread roll, a new route, and three observations about trees.",
    extra: () => state.weather === "rain"
      ? "I'm at the good part of the book. Outside is also at the good part."
      : "A perfectly good day for a bicycle ride. Or for thinking about a bicycle ride.",
    actions: () => [
      roomAction("sun", "A bit of sunshine", () => changeState({ weather: "sun" }, "The long way home looks inviting."), { pressed: state.weather === "sun" }),
      roomAction("rain", "Let it drizzle", () => changeState({ weather: "rain" }, "Excellent walking weather. Also excellent staying-in weather."), { pressed: state.weather === "rain" }),
    ],
  },
  postcards: {
    label: "The postcards",
    title: () => postcardMemories[state.postcard].title,
    story: () => postcardMemories[state.postcard].story,
    extra: () => postcardMemories[state.postcard].extra,
    actions: () => [
      roomAction("turn", "Turn to another memory", () => changeState({ postcard: (state.postcard + 1) % 3 }, "A different detour, equally worth taking.")),
      roomAction("pin", state.pinnedPostcard === state.postcard ? "This one's pinned" : "Pin this one", () => changeState({ pinnedPostcard: state.postcard }, "A good memory deserves a spot on the wall."), { pressed: state.pinnedPostcard === state.postcard }),
    ],
  },
  plant: {
    label: "The basil",
    title: () => "A cutting from a friend.",
    story: () => "Jo brought it over in a little pot. I sent the pot home full of biscuits. A very good exchange rate.",
    extra: () => state.watered
      ? "That's enough water for this visit. We can just appreciate the leaves now."
      : "It is doing its best. I try to remember that when it looks a little dramatic.",
    actions: () => [
      roomAction("water", state.watered ? "Looking happier" : "Give it a little water", () => changeState({ watered: true }, "A small kindness. Basil noticed."), { disabled: state.watered }),
    ],
  },
  radio: {
    label: "Jo's radio",
    title: () => "It plays. Mostly.",
    story: () => "Jo asked if I could fix this. I said yes with the confidence of someone who had not opened it yet.",
    extra: () => `It plays now. The remaining screw is a separate mystery. On the dial: "${tracks[state.track]}," a little original tune made right here in your browser.`,
    actions: () => [
      roomAction("sound", "Play something quiet", () => { void setSound(!soundWanted); }, { sound: true }),
      roomAction("station", "Try the next station", () => {
        const track = (state.track + 1) % tracks.length;
        changeState({ track }, `The dial says "${tracks[track]}."`);
      }),
    ],
  },
  lamp: {
    label: "The little lamp",
    title: () => "A smaller sort of light.",
    story: () => "I found it in a secondhand shop under a very ugly clock. The person at the counter said it was too small to be useful.",
    extra: () => "It makes everything feel less urgent. I think that counts.",
    actions: () => [
      roomAction("day", "Keep the afternoon", () => changeState({ theme: "day" }, "There's still a little afternoon left."), { pressed: state.theme === "day" }),
      roomAction("evening", "Put the little lamp on", () => changeState({ theme: "evening" }, "Small lamp. Softer plans."), { pressed: state.theme === "evening" }),
    ],
  },
  tea: {
    label: "Tea for two",
    title: () => "I made two.",
    story: () => "Optimism, not a head count. I kept the uneven mug because it's the one my friend made.",
    extra: () => state.tea === "none"
      ? "Yours is the yellow one. Something fresh, or something warm and a little spicy?"
      : `A cup of ${state.tea} for you, and a matching one for me. Take the comfortable chair. The other one is holding the laundry.`,
    actions: () => [
      roomAction("mint", "Mint sounds good", () => changeState({ tea: "mint" }, "Two cups of mint. No need to say anything clever."), { pressed: state.tea === "mint" }),
      roomAction("ginger", "Ginger, please", () => changeState({ tea: "ginger" }, "Ginger it is. Stay until it's cool enough to drink."), { pressed: state.tea === "ginger" }),
    ],
  },
  book: {
    label: "The mystery book",
    title: () => "One more chapter.",
    story: () => state.bookmarked
      ? '"The missing key was in the sugar bowl. The inspector decided, just this once, to finish her tea before telling anyone."'
      : "A gentle mystery. The stakes are low, the village is nosy, and somebody has definitely misplaced a key.",
    extra: () => state.bookmarked
      ? "A tiny story written for this room. I like a detective who has her priorities straight."
      : "Stopped at page 47. The window got interesting. That's allowed.",
    actions: () => [
      roomAction("read", state.bookmarked ? "Page marked for later" : "Read a little bit", () => changeState({ bookmarked: true }, "A page, not an assignment. The bookmark is in."), { disabled: state.bookmarked }),
    ],
  },
  mending: {
    label: "The mending basket",
    title: () => "These socks have been places.",
    story: () => "The ferry trip. The walk home. A surprisingly muddy shortcut that was, in retrospect, a field.",
    extra: () => state.mended
      ? "I like the repair showing. Something can be a little worn and still worth taking care of."
      : "They're not finished yet. Most good things around here aren't.",
    actions: () => [
      roomAction("stitch", state.mended ? "A good little repair" : "Add a red stitch", () => changeState({ mended: true }, "One thing finished. Let's not get carried away."), { disabled: state.mended }),
    ],
  },
  cat: {
    label: "Crumb",
    title: () => "Head of seating.",
    story: () => "Crumb was not invited to the household. Crumb reviewed the household and accepted our application.",
    extra: () => state.cat === "chair"
      ? "The chair is now occupied. We are all very grateful for this development."
      : "Currently supervising the rug. Any suggestion that this is sleeping will be ignored.",
    actions: () => [
      roomAction("chair", state.cat === "chair" ? "Suggest the sunny rug" : "Offer the chair", () => {
        const cat = state.cat === "chair" ? "rug" : "chair";
        changeState({ cat }, cat === "chair" ? "Crumb moved six inches. A generous compromise." : "The rug has been graciously re-accepted.");
      }),
    ],
  },
};

function renderNotebook() {
  if (!selectedObject) return;
  const object = objects[selectedObject];
  const focusedAction = document.activeElement?.dataset.action;
  const hadControlFocus = byId("note-actions").contains(document.activeElement);
  byId("note-kicker").textContent = "A SMALL THING WITH A STORY";
  byId("note-number").textContent = String(objectIds.indexOf(selectedObject) + 1).padStart(2, "0");
  byId("note-title").textContent = object.title();
  byId("note-body").textContent = object.story();
  byId("note-extra").textContent = object.extra();
  byId("note-result").textContent = noteResult;
  byId("note-navigation").hidden = false;
  const controls = object.actions().map((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.dataset.action = action.id;
    button.textContent = action.label;
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
    : "A little something, after nine little things.";
  renderNotebook();
  syncSoundControls();
}

function selectObject(id, { moveToNote = false } = {}) {
  selectedObject = id;
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
      byId("discoveries-dialog").close();
      lastHotspot = document.querySelector(`[data-object="${id}"]`);
      selectObject(id, { moveToNote: true });
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

function residentReply(prompt) {
  let reply;
  if (prompt === "plans") {
    reply = state.mended
      ? "One thing finished. Let's not get carried away. Jo's radio can go home tomorrow."
      : state.weather === "rain"
        ? "Jo and I usually walk on Sundays. Today the walk may end at the kettle."
        : "A bike ride with no useful destination. If I bring back bread, that's a bonus.";
  } else if (prompt === "joy") {
    reply = state.tea !== "none"
      ? "Someone sitting long enough for the tea to cool. This, actually."
      : state.cat === "chair"
        ? "A cat deciding you're furniture. It's an oddly nice vote of confidence."
        : "The friend who calls without needing anything. Also, a really good biscuit.";
  } else {
    const advice = [
      "You can be a beginner at something just because it looks fun. No need to get impressive about it.",
      "Keep the uneven mug. Call the friend. Take the route with the trees.",
      "Some days, taking care of one small thing is quite enough.",
      "An unanswered question is not a personal failure. Sometimes it's just a good reason to make tea.",
    ];
    reply = advice[adviceIndex++ % advice.length];
  }
  byId("resident-reply").textContent = `"${reply}"`;
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
  const label = audioBusy ? "One moment..." : playing ? "Sound on" : "Sound off";
  byId("sound-label").textContent = label;
  byId("sound-toggle").setAttribute("aria-pressed", String(playing));
  byId("sound-toggle").disabled = audioBusy;
  for (const button of document.querySelectorAll("[data-sound-control]")) {
    button.textContent = audioBusy ? "One moment..." : playing ? "Let it be quiet" : "Play something quiet";
    button.disabled = audioBusy;
    button.setAttribute("aria-pressed", String(playing));
  }
}

async function closeSound() {
  clearInterval(audioTimer);
  const previous = audioContext;
  audioContext = null;
  audioMaster = null;
  for (const note of activeNotes) {
    note.oscillator.onended = null;
    note.oscillator.disconnect();
    note.gain.disconnect();
  }
  activeNotes.clear();
  if (previous && previous.state !== "closed") await previous.close();
}

async function setSound(enabled) {
  soundWanted = enabled && !document.hidden;
  if (audioBusy) return; // Hidden-tab cancellation is consumed after resume below.
  audioBusy = true;
  syncSoundControls();
  try {
    if (!soundWanted) {
      await closeSound();
    } else if (!audioContext) {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) {
        soundWanted = false;
        announce("This browser can't play the little radio. All nine discoveries are still yours.");
        return;
      }
      audioContext = new AudioContextClass();
      audioContext.addEventListener("statechange", syncSoundControls);
      await audioContext.resume();
      if (!soundWanted || document.hidden) {
        await closeSound();
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
    announce("The radio couldn't start here. Everything else in the room is still open.");
  } finally {
    audioBusy = false;
    syncSoundControls();
  }
}

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
    openDialog(byId("letter-dialog"));
  } else {
    updateDiscoveries();
    openDialog(byId("discoveries-dialog"));
  }
});
byId("lamp-toggle").addEventListener("click", () => {
  discover("lamp");
  changeState({ theme: state.theme === "day" ? "evening" : "day" },
    state.theme === "day" ? "Small lamp. Softer plans." : "There's still a little afternoon left.");
});
byId("sound-toggle").addEventListener("click", () => { void setSound(!soundWanted); });
byId("motion-toggle").addEventListener("change", (event) => changeState(
  { reducedMotion: event.target.checked }, event.target.checked ? "The room will keep still." : "A little movement is back.",
));
byId("size-toggle").addEventListener("change", (event) => changeState(
  { largeText: event.target.checked }, event.target.checked ? "A little easier on the eyes." : "Back to the usual text size.",
));
byId("contrast-toggle").addEventListener("change", (event) => changeState(
  { contrast: event.target.checked }, event.target.checked ? "A little more definition." : "Back to the softer outlines.",
));
byId("reset-visit").addEventListener("click", () => {
  const preferences = { reducedMotion: state.reducedMotion, largeText: state.largeText, contrast: state.contrast };
  state = { ...initialState(), ...preferences };
  selectedObject = null;
  noteResult = "";
  byId("note-kicker").textContent = "A NOTE FROM THE RESIDENT";
  byId("note-number").textContent = "f9";
  byId("note-title").textContent = "Oh, hello again.";
  byId("note-body").textContent = "Same room. Fresh cup. No need to remember where you left off.";
  byId("note-extra").textContent = "The little things are ready to be found again.";
  byId("note-result").textContent = "";
  byId("note-actions").replaceChildren();
  byId("note-navigation").hidden = true;
  persistState();
  render();
  void setSound(false);
  announce("A fresh visit. Your reading preferences stayed put.");
});
motionPreference.addEventListener("change", render);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void setSound(false);
});
window.addEventListener("pagehide", () => { void setSound(false); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "9" || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      document.querySelector("dialog[open]") ||
      event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
  lastHotspot = document.querySelector('[data-object="cat"]');
  selectObject("cat", { moveToNote: true });
});
render();
root.dataset.ready = "true";
