export const STORAGE_KEY = "friend9.room.v1";
export const OBJECT_IDS = Object.freeze([
  "window", "postcards", "plant", "radio", "lamp", "tea", "book", "mending", "cat",
]);
export const PLAN_IDS = Object.freeze(["scenic", "radio", "mug"]);
export const SCRAP_IDS = Object.freeze(["shelf", "tin", "map", "drawer", "bicycle", "nine"]);

export function freshState(evening = false) {
  return {
    version: 2,
    seen: [],
    theme: evening ? "evening" : "day",
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
    plans: { scenic: true, radio: false, mug: true },
    scraps: [],
  };
}

function validIds(values, allowed) {
  return Array.isArray(values) && values.length <= allowed.length &&
    values.every((id) => allowed.includes(id)) && new Set(values).size === values.length;
}

export function readStoredState(raw, evening = false) {
  if (raw === null) return { state: freshState(evening), notice: null };
  if (typeof raw !== "string" || raw.length > 4096) {
    return { state: freshState(evening), notice: "Saved room settings couldn't be read. This visit starts fresh." };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { state: freshState(evening), notice: "Saved room settings couldn't be read. This visit starts fresh." };
  }
  const valid = value !== null && typeof value === "object" && !Array.isArray(value) &&
    [1, 2].includes(value.version) && validIds(value.seen, OBJECT_IDS) &&
    ["day", "evening"].includes(value.theme) && ["sun", "rain"].includes(value.weather) &&
    ["none", "mint", "ginger"].includes(value.tea) && ["rug", "chair"].includes(value.cat) &&
    [0, 1, 2].includes(value.postcard) && [null, 0, 1, 2].includes(value.pinnedPostcard) &&
    [0, 1, 2].includes(value.track) &&
    ["watered", "mended", "bookmarked", "reducedMotion", "largeText", "contrast"]
      .every((key) => typeof value[key] === "boolean") &&
    (value.version === 1 || (
      value.plans !== null && typeof value.plans === "object" && !Array.isArray(value.plans) &&
      PLAN_IDS.every((id) => typeof value.plans[id] === "boolean") &&
      validIds(value.scraps, SCRAP_IDS)
    ));
  if (!valid) {
    return { state: freshState(evening), notice: "Saved room settings couldn't be read. This visit starts fresh." };
  }
  const state = freshState(evening);
  for (const key of Object.keys(state)) {
    if (["version", "plans", "scraps"].includes(key)) continue;
    state[key] = key === "seen" ? [...value.seen] : value[key];
  }
  if (value.version === 2) {
    state.plans = Object.fromEntries(PLAN_IDS.map((id) => [id, value.plans[id]]));
    state.scraps = [...value.scraps];
  }
  return { state, notice: null };
}

export function togglePin(state) {
  return state.pinnedPostcard === state.postcard ? null : state.postcard;
}

export function resetDiscoveries(state, evening = false) {
  return {
    ...freshState(evening),
    theme: state.theme,
    reducedMotion: state.reducedMotion,
    largeText: state.largeText,
    contrast: state.contrast,
  };
}
