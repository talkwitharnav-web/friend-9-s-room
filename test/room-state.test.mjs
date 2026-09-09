import assert from "node:assert/strict";
import { test } from "node:test";
import {
  freshState, readStoredState, resetDiscoveries, togglePin, OBJECT_IDS, SCRAP_IDS,
} from "../public/room-state.js";

test("existing visitors keep all discoveries and preferences when lore is added", () => {
  const original = {
    version: 1, seen: [...OBJECT_IDS], theme: "evening", weather: "rain",
    tea: "mint", watered: true, mended: true, cat: "chair",
    postcard: 1, pinnedPostcard: 2, bookmarked: true, track: 2,
    reducedMotion: true, largeText: true, contrast: true,
  };
  const { state, notice } = readStoredState(JSON.stringify(original));
  assert.equal(notice, null);
  for (const [key, value] of Object.entries(original)) {
    if (key !== "version") assert.deepEqual(state[key], value, key);
  }
  assert.equal(state.version, 2);
  assert.deepEqual(state.plans, { scenic: true, radio: false, mug: true });
  assert.deepEqual(state.scraps, []);
});

test("pinning is a reversible toggle and other postcards do not inherit it", () => {
  const state = freshState();
  state.pinnedPostcard = togglePin(state);
  assert.equal(state.pinnedPostcard, 0);
  state.pinnedPostcard = togglePin(state);
  assert.equal(state.pinnedPostcard, null);
  state.postcard = 2;
  state.pinnedPostcard = togglePin(state);
  state.postcard = 1;
  assert.equal(state.pinnedPostcard, 2);
  state.pinnedPostcard = togglePin(state);
  assert.equal(state.pinnedPostcard, 1);
  state.pinnedPostcard = togglePin(state);
  assert.equal(state.pinnedPostcard, null);
});

test("every reversible plan combination and all scraps round-trip independently", () => {
  for (let bits = 0; bits < 8; bits++) {
    const state = freshState();
    state.plans = { scenic: Boolean(bits & 1), radio: Boolean(bits & 2), mug: Boolean(bits & 4) };
    state.scraps = [...SCRAP_IDS];
    state.seen = [...OBJECT_IDS];
    const restored = readStoredState(JSON.stringify(state));
    assert.equal(restored.notice, null);
    assert.deepEqual(restored.state, state);
  }
});

test("unknown and malformed saved state is surfaced, never executed or trusted", () => {
  const state = freshState();
  const invalid = [
    "{not json", "x".repeat(4097), "null", "[]", '{"version":3}',
    JSON.stringify({ ...state, seen: ["window", "window"] }),
    JSON.stringify({ ...state, scraps: ["secret-file"] }),
    JSON.stringify({ ...state, plans: { scenic: true, radio: 1, mug: false } }),
    JSON.stringify({ ...state, pinnedPostcard: "<script>" }),
  ];
  for (const raw of invalid) {
    const result = readStoredState(raw);
    assert.ok(result.notice, raw.slice(0, 50));
    assert.deepEqual(result.state, state);
  }
  const extra = readStoredState(JSON.stringify({
    ...state, secret: "not a field", plans: { ...state.plans, surprise: "ignored" },
  }));
  assert.equal(extra.notice, null);
  assert.deepEqual(extra.state, state);
});

test("fresh visits reset story choices but preserve reading preferences and theme", () => {
  const state = freshState(true);
  state.seen = [...OBJECT_IDS];
  state.scraps = [...SCRAP_IDS];
  state.largeText = true;
  state.reducedMotion = true;
  state.contrast = true;
  state.plans.scenic = false;
  const reset = resetDiscoveries(state);
  assert.equal(reset.theme, "evening");
  assert.equal(reset.largeText, true);
  assert.equal(reset.reducedMotion, true);
  assert.equal(reset.contrast, true);
  assert.deepEqual(reset.seen, []);
  assert.deepEqual(reset.scraps, []);
  assert.deepEqual(reset.plans, freshState().plans);
  assert.equal(readStoredState(null, true).state.theme, "evening");
});
