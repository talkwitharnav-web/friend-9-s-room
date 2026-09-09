export const OBJECT_LABELS = Object.freeze({
  window: "The window",
  postcards: "The postcards",
  plant: "Jo's basil",
  radio: "Jo's radio",
  lamp: "The little lamp",
  tea: "Tea for two",
  book: "The mystery book",
  mending: "The mending basket",
  cat: "Crumb",
});

export const TRACKS = Object.freeze(["Window seat", "Slow Sunday", "The scenic route"]);

const postcards = [
  {
    title: "The Ferry Was Punctual",
    glance: "The ferry, leaving. That was the one I meant to catch.",
  },
  {
    title: "Backstep's Ninth Chair",
    glance: "Backstep Bakery: chair nine, Jo's radio, and my cardigan missing its bottom red button.",
  },
  {
    title: "Shoes in the Basket",
    glance: "My shoes rode home in the bicycle basket; my socks did the hard part.",
  },
];

const stories = {
  window: (state) => ({
    title: "The Long Way Around",
    glance: state.plans.scenic
      ? "Towpath today. Jo reported a heron near the lock. Both routes pass Backstep Bakery, of course."
      : "Market square today. Inez wants an opinion on fennel bread. Both routes pass Backstep Bakery, of course.",
    detail: "I missed the ferry and waited there with Jo's radio. A chair wobbled, so I stayed to fix it. The ferry made three more trips without me. I planned carefully.",
    related: "postcards", link: "See the ferry day",
  }),
  postcards: (state) => ({
    ...postcards[state.postcard],
    detail: "Inez mailed these from two streets away. She says postcards should travel. Technically, these did. Three postcards and one red pin: pick a favorite for the wall.",
    related: "mending", link: "Find those walking socks",
  }),
  plant: (state) => ({
    title: "Jo's Spare Basil",
    glance: state.plans.radio
      ? "Jo brought this cutting in a yogurt cup. We could choose Inez's cutting when Jo comes for the radio."
      : "Jo brought this cutting in a yogurt cup. I'll sketch it and ask her which stem Inez should get.",
    detail: `Its parent lives on Jo's sill. Inez requested a cutting while finding a washer for my lamp. I like imagining the same plant in three kitchens.${state.watered ? " This one has had its drink." : ""}`,
    related: "lamp", link: "Follow that lamp washer",
  }),
  radio: (state) => ({
    title: "Unscheduled Percussion",
    glance: state.plans.radio
      ? "Jo lent this for the ferry picnic. Packing tag ready; pickup still needs arranging."
      : "Jo lent this for the ferry picnic. Keeping it here for a possible kitchen-dancing afternoon.",
    detail: "It rattled even when switched off. I blamed a screw. Jo asked whether my cardigan had always closed unevenly. The postcards contain evidence; her repair note is in the drawer.",
    related: "book", link: "Consult the detective",
  }),
  lamp: () => ({
    title: "Good Parts, Bad Forks",
    glance: "The replacement washer came from Inez's cookie tin. The cookies left years ago.",
    detail: "I repair things at the bakery's back table. Inez keeps offering bent forks. This lamp came home afterward; chair nine stayed at the bakery.",
    related: "cat", link: "Inspect the other chair",
  }),
  tea: (state) => ({
    title: "The Crooked Handle",
    glance: state.plans.mug
      ? "Jo made this mug. The handle makes sense if you tilt your head. I'm using it for tea."
      : "Jo's crooked mug gets the pencils today. I'll take a plain cup for tea.",
    detail: `Jo drinks ginger; Inez likes mint. Reversing them once produced forty minutes of polite swapping. The mug doesn't leak. I checked it over a towel, just in case.${state.tea !== "none" ? ` Today's tea is ${state.tea}.` : ""}`,
    related: "plant", link: "Another of Jo's gifts",
  }),
  book: (state) => ({
    title: "A Questionable Alibi",
    glance: state.plans.mug
      ? "The detective has overlooked a bicycle. My three pencil objections can stay in the drawer while we have tea."
      : "The detective has overlooked a bicycle. My pencil objections now have a crooked pencil holder.",
    detail: "Inez reads endings first. Jo remembers every suspect except the guilty one. We eat buns and disagree about what happened. My old ferry ticket is the bookmark.",
    related: "tea", link: "Meet the book club's cups",
  }),
  mending: (state) => ({
    title: "The Ferry-Day Socks",
    glance: state.plans.scenic
      ? "These socks survived the walk home better than my cardigan survived lunch. I'd take them on the longer ride."
      : "These socks survived the walk home better than my cardigan survived lunch. A shorter outing for them today.",
    detail: "My shoes rubbed, so I walked in socks. This red thread was originally for a loose cardigan button. Then the button disappeared. The repair can show; these socks have been places.",
    related: "radio", link: "Meet the other suspect",
  }),
  cat: (state) => ({
    title: "An Excellent Alibi",
    glance: state.cat === "chair"
      ? "Crumb was home asleep when the radio began rattling. She is now resting her case on the chair."
      : "Crumb was home asleep when the radio began rattling. An unusually cooperative witness.",
    detail: "Bakery chair nine lacks a cushion, so she prefers mine. From the window she supervises geese, which are apparently doing everything wrong.",
    related: "window", link: "See Crumb's jurisdiction",
  }),
};

export function getStory(id, state) {
  if (!Object.hasOwn(stories, id)) throw new Error(`Unknown room story: ${id}`);
  return stories[id](state);
}

const scraps = {
  shelf: {
    title: "The Club Rules",
    body: 'Bring a book. Disagree about it. Inez added: "Buy your own bun." Jo added a drawing of an unaffordable bun.',
    related: "book", link: "Open our current mystery",
    reaction: (state) => state.plans.mug
      ? "Books, bicycle routes, and repairs share this shelf. The pencil objections are in the drawer."
      : "Books, bicycle routes, and repairs share this shelf. The pencils have moved into Jo's mug.",
  },
  tin: {
    title: "Contents Have Changed",
    body: "Washers, patches, one excellent screw. Inez still opens this hopefully, despite being the person who put the hardware inside.",
    related: "lamp", link: "See what one washer fixed",
    reaction: (state) => state.mended
      ? "One patch used, one pair of socks ready. Still no cookies."
      : "The tin sits beside a box of saved buttons. Most of them have sensible explanations.",
  },
  map: {
    title: "A Cartographic Dispute",
    body: 'Jo labeled the hill "character building." I crossed it out and wrote "poor gearing." Both labels remain.',
    related: "window", link: "Look out toward Alder Quay",
    reaction: (state) => state.plans.scenic
      ? "Today's pencil line follows the towpath past the lock. Keep an eye out for Jo's alleged heron."
      : "Today's pencil line goes through the square. Fennel bread awaits judgment.",
  },
  drawer: {
    title: "Not Electrical",
    body: '"Found your red cardigan button behind the radio handle. Removed button. Radio fixed. Cardigan still your problem." Jo.',
    related: "mending", link: "Reunite the thread and its job",
    reaction: (state) => state.plans.radio
      ? "The matching red button is here, beside the note. Jo's radio has its pickup tag, but is still on the desk."
      : "The matching red button is here, beside the note. Crumb's alibi held. The radio can stay for another song.",
  },
  bicycle: {
    title: "Cargo Manifest",
    body: "Usual cargo: bread, library books, something Jo says is almost repaired. Once: both shoes. The bell survived every arrangement.",
    related: "postcards", link: "See the shoes' journey",
    reaction: (state) => state.plans.scenic
      ? "The towpath is penciled in. A shoelace still caught in the basket remembers the last long ride."
      : "The market route is penciled in. There's room in the basket for a loaf and a strongly held opinion.",
  },
  nine: {
    title: "Before It Was A Name",
    body: 'The bakery\'s chairs came numbered from an auction. I fixed nine. Inez wrote "Friend 9" on my tea order. Eventually I started answering.',
    related: "postcards", link: "Find the bakery postcard",
    reaction: () => "Alder Quay is small. Two streets, one repaired chair, and a nickname can travel surprisingly far.",
  },
};

export function getScrap(id, state) {
  if (!Object.hasOwn(scraps, id)) throw new Error(`Unknown room scrap: ${id}`);
  const scrap = scraps[id];
  return { ...scrap, reaction: scrap.reaction(state) };
}

const planLines = {
  scenic: [
    "Market square. Inez wants an opinion on fennel bread.",
    "Towpath today. Jo reported a heron near the lock.",
  ],
  radio: [
    "Keeping it here for a possible kitchen-dancing afternoon.",
    "Packing tag ready. I still need to arrange pickup with Jo.",
  ],
  mug: [
    "A plain cup for tea. Jo's mug gets the pencils.",
    "Jo's mug on a saucer. The pencils can stay in the drawer.",
  ],
};

const planReplies = {
  scenic: [
    "Inez wants an opinion on fennel bread. I've been developing one for years.",
    "Jo says there's a heron by the lock. Last time her binoculars found a grocery bag.",
  ],
  radio: [
    "I may attempt kitchen dancing. Crumb's review last time was a very deliberate exit.",
    "I'll ask Jo about pickup. First, I want her official diagnosis of the cardigan.",
  ],
  mug: [
    "That mug is about to become very well informed about fictional bicycle crimes.",
    "Jo called that handle experimental. I'm calling this tea the field trial.",
  ],
};

export function planReaction(id, state) {
  if (id === null) {
    return `${state.plans.scenic ? "Towpath" : "Market square"}, ${state.plans.radio ? "a radio ready for Jo" : "a little radio"}, and ${state.plans.mug ? "the wonky mug" : "a plain cup"}. For this afternoon.`;
  }
  if (!Object.hasOwn(planLines, id)) throw new Error(`Unknown afternoon plan: ${id}`);
  return planLines[id][Number(state.plans[id])];
}

export function residentLine(prompt, state, turn = 0) {
  if (prompt.startsWith("plan:")) {
    const id = prompt.slice(5);
    if (!Object.hasOwn(planReplies, id)) throw new Error(`Unknown conversation plan: ${id}`);
    return planReplies[id][Number(state.plans[id])];
  }
  const pools = {
    plans: [
      state.plans.radio
        ? "I'll ask Jo about pickup. First, I want her official diagnosis of the cardigan."
        : state.plans.scenic
          ? "Jo says there's a heron by the lock. Last time her binoculars found a grocery bag."
          : "Inez wants an opinion on fennel bread. I've been developing one for years.",
      state.plans.radio
        ? "The radio is tagged, not gone. I know better than to promise Jo I'll be ready on time."
        : "I may attempt kitchen dancing. Crumb's review last time was a very deliberate exit.",
    ],
    joy: [
      state.tea !== "none"
        ? `A cup of ${state.tea}, someone to share it with, and no fennel in the biscuits. A very good combination.`
        : "Inez mailed a postcard across two streets. She put a stamp on it and everything.",
      state.cat === "chair"
        ? "Crumb has claimed the chair. She asked by sitting on it, which is her usual paperwork."
        : "Crumb's grand expedition today was from the chair to the rug. She returned with several complaints.",
      "Fixing the bakery chair took twenty minutes. Sitting there with Inez took the rest of the afternoon.",
    ],
    advice: [
      state.plans.mug
        ? "Jo called that handle experimental. I'm calling this tea the field trial."
        : "That mug is about to become very well informed about fictional bicycle crimes.",
      "A biscuit should fit in the cup without advanced engineering. I have written this down for Inez.",
      "If a detective ignores a bicycle, the reader is entitled to three pencil objections. At least.",
      "Fennel bread is a conversation I will finish when I have more time and less fennel bread.",
    ],
  };
  if (!Object.hasOwn(pools, prompt)) throw new Error(`Unknown resident prompt: ${prompt}`);
  return pools[prompt][turn % pools[prompt].length];
}

export function getLetter(state) {
  return {
    story: "Thanks for coming over. A missed ferry turned into a repaired chair, a nickname, and two friends I now see whenever I can.",
    plans: `I've penciled in ${state.plans.scenic ? "the towpath" : "the square"}. Jo's radio ${state.plans.radio ? "has its packing tag ready" : "is staying here"}, and the crooked mug ${state.plans.mug ? "gets the tea" : "keeps the pencils"}. I'll see Inez either way. I liked fixing her chair. I like knowing her better.`,
  };
}
