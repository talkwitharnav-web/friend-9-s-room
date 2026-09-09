import assert from "node:assert/strict";
import { test } from "node:test";
import { freshState, OBJECT_IDS, SCRAP_IDS, PLAN_IDS } from "../public/room-state.js";
import { getStory, getScrap, planReaction, residentLine, getLetter } from "../public/room-content.js";

test("all nine stories have concise glances and real connected destinations", () => {
  for (const id of OBJECT_IDS) {
    const story = getStory(id, freshState());
    assert.ok(story.title.length > 0);
    assert.ok(story.title.split(/\s+/).length <= 6, id);
    assert.ok(story.glance.split(/\s+/).length <= 45, id);
    assert.ok(story.detail.split(/\s+/).length <= 55, id);
    assert.ok([...OBJECT_IDS, ...SCRAP_IDS].includes(story.related), id);
    assert.ok(story.link.length > 0);
  }
});

test("each checkbox changes two connected stories and a resident reaction, reversibly", () => {
  const connections = { scenic: ["window", "mending"], radio: ["radio", "plant"], mug: ["tea", "book"] };
  for (const id of PLAN_IDS) {
    const state = freshState();
    const original = connections[id].map((object) => getStory(object, state));
    const originalReply = residentLine(`plan:${id}`, state);
    const originalReaction = planReaction(id, state);
    state.plans[id] = !state.plans[id];
    connections[id].forEach((object, index) => {
      assert.notDeepEqual(getStory(object, state), original[index], `${id} -> ${object}`);
    });
    assert.notEqual(residentLine(`plan:${id}`, state), originalReply);
    assert.notEqual(planReaction(id, state), originalReaction);
    state.plans[id] = !state.plans[id];
    connections[id].forEach((object, index) => assert.deepEqual(getStory(object, state), original[index]));
  }
});

test("the small mystery and nickname have explicit connected payoffs", () => {
  const state = freshState();
  assert.match(getStory("radio", state).detail, /cardigan/);
  assert.match(getStory("mending", state).detail, /button/);
  assert.match(getStory("cat", state).glance, /home asleep/);
  assert.match(getScrap("drawer", state).body, /red cardigan button behind the radio handle/);
  assert.match(getScrap("nine", state).body, /I fixed nine/);
  for (const id of SCRAP_IDS) {
    const scrap = getScrap(id, state);
    assert.ok(scrap.body.split(/\s+/).length <= 40, id);
    assert.ok([...OBJECT_IDS, ...SCRAP_IDS].includes(scrap.related), id);
  }
});

test("every plan combination gets an honest completion letter without fictional completed errands", () => {
  for (let bits = 0; bits < 8; bits++) {
    const state = freshState();
    state.plans = { scenic: Boolean(bits & 1), radio: Boolean(bits & 2), mug: Boolean(bits & 4) };
    const letter = getLetter(state);
    assert.match(letter.plans, state.plans.scenic ? /the towpath/ : /the square/);
    assert.match(letter.plans, state.plans.radio ? /packing tag ready/ : /is staying here/);
    assert.match(letter.plans, state.plans.mug ? /gets the tea/ : /keeps the pencils/);
    assert.doesNotMatch(letter.plans, /already returned|already delivered|sent Jo a message/);
  }
});

test("content boundaries reject unknown identifiers instead of masking bad links", () => {
  const state = freshState();
  assert.throws(() => getStory("missing", state), /Unknown room story/);
  assert.throws(() => getScrap("missing", state), /Unknown room scrap/);
  assert.throws(() => planReaction("missing", state), /Unknown afternoon plan/);
  assert.throws(() => residentLine("missing", state), /Unknown resident prompt/);
});
