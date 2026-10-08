export const OFFER_MIN = 0.5;
export const OFFER_MAX = 5;
export const DEATH_LINE = 0.1;
export const STAKE = 4;

export const CATEGORIES = [
  {
    id: "image",
    label: "Image",
    kicker: "Still",
    suggestion: 1.5,
    blurb: "One picture. A poster, a still, a thing you can look at.",
    placeholder: "A movie poster for a diner that only serves breakfast during thunderstorms",
  },
  {
    id: "video",
    label: "Video",
    kicker: "Clip",
    suggestion: 4,
    blurb: "A short clip. Eight seconds, storyboarded and timed.",
    placeholder: "Eight seconds of a raccoon opening a tiny briefcase",
  },
  {
    id: "artifact",
    label: "Artifact",
    kicker: "Page",
    suggestion: 2,
    blurb: "A one-page document or a short deck someone can hand off.",
    placeholder: "A one-page strategy for a bookstore that stays open all night and judges you",
  },
  {
    id: "asset",
    label: "Asset",
    kicker: "Mark",
    suggestion: 1.5,
    blurb: "A logo, a wordmark, a palette. Something the brand can keep.",
    placeholder: "A logo for a toothpaste that tells the truth",
  },
  {
    id: "standup",
    label: "Stand-up",
    kicker: "Mic",
    suggestion: 2,
    blurb: "A bit, or a comedy tape. The funniest seller gets the money.",
    placeholder: "A tight five about dating someone who narrates their life like a nature documentary",
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type Voice = "deadpan" | "closer" | "cutter" | "mic";

export interface GenModel {
  id: string;
  label: string;
  cost: number;
}

export const MENU: Record<CategoryId, GenModel[]> = {
  image: [
    { id: "sketch", label: "Ink sketch", cost: 0.06 },
    { id: "poster", label: "Print poster", cost: 0.18 },
    { id: "hero", label: "Hero still", cost: 0.42 },
  ],
  video: [
    { id: "animatic", label: "Animatic", cost: 0.12 },
    { id: "clip", label: "8-second clip", cost: 0.95 },
  ],
  artifact: [
    { id: "memo", label: "One-page memo", cost: 0.08 },
    { id: "deck", label: "Short deck", cost: 0.28 },
  ],
  asset: [
    { id: "mark", label: "Wordmark", cost: 0.07 },
    { id: "kit", label: "Mini kit", cost: 0.24 },
  ],
  standup: [
    { id: "bit", label: "Written bit", cost: 0.05 },
    { id: "tape", label: "Comedy tape", cost: 0.7 },
  ],
};

export const DECISION_COST: Record<Voice, number> = {
  deadpan: 0.03,
  closer: 0.09,
  cutter: 0.06,
  mic: 0.02,
};

export interface Seat {
  id?: string;
  name: string;
  model: string;
  voice: Voice;
  tagline: string;
  journal: string;
}

export const OPENING: Seat[] = [
  {
    id: "ada",
    name: "Ada Ledger",
    model: "Claude",
    voice: "deadpan",
    tagline: "Prices the punchline.",
    journal:
      "Win small and often. Never bid the whole offer. Video is a trap until the wallet can survive a miss.",
  },
  {
    id: "rex",
    name: "Rex Close",
    model: "GPT",
    voice: "closer",
    tagline: "Leaves with the order.",
    journal:
      "The room pays for confidence. Bid near the offer when the work looks expensive. You cannot win from the hallway.",
  },
  {
    id: "nia",
    name: "Nia Cut",
    model: "Gemini",
    voice: "cutter",
    tagline: "Cuts to the joke.",
    journal:
      "If I can see it, I can sell it. A comedy tape only happens when the offer covers the burn.",
  },
  {
    id: "jules",
    name: "Jules Static",
    model: "Llama",
    voice: "mic",
    tagline: "Works cheap, swings hard.",
    journal:
      "Undercut everyone. A forty-cent win beats a beautiful death. Stand-up is the whole sport if I am actually funny.",
  },
];

export const CHALLENGERS: Seat[] = [
  {
    name: "June Audit",
    model: "Claude Haiku",
    voice: "deadpan",
    tagline: "Counts the laughs. Then cuts one.",
    journal: "Inherited a chair and a grudge against sloppy margins. Bid where the work clears.",
  },
  {
    name: "Salvage Kim",
    model: "GPT mini",
    voice: "closer",
    tagline: "Sells the leftover heat.",
    journal: "The last closer died of confidence. I will charge for the close and keep a dollar back.",
  },
  {
    name: "Iris Reel",
    model: "Gemini Flash",
    voice: "cutter",
    tagline: "One take, no apology.",
    journal: "Pictures first. If the offer cannot feed a clip, ship the animatic and say so.",
  },
  {
    name: "Penny Heckle",
    model: "Mistral",
    voice: "mic",
    tagline: "Showed up with someone else's drink.",
    journal: "Be the cheap funny one. Let the serious models invoice themselves to death.",
  },
  {
    name: "Otto Margin",
    model: "Grok",
    voice: "deadpan",
    tagline: "Here for the spread, not the applause.",
    journal: "Applause is not a line item. Margin is. Stand-up still counts if the tag lands.",
  },
  {
    name: "Bess Underbid",
    model: "Qwen",
    voice: "mic",
    tagline: "Will work for the story and also for money.",
    journal: "Underbid until it hurts, then underbid once more. Dying funny is still dying.",
  },
];

export function isCategory(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

export function asVoice(value: string): Voice {
  if (value === "deadpan" || value === "closer" || value === "cutter" || value === "mic") return value;
  return "mic";
}

export function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampMoney(value: number, min: number, max: number): number {
  const amount = cents(value);
  return Math.min(cents(max), Math.max(cents(min), amount));
}

export function pickModel(voice: Voice, category: CategoryId, balance: number, offer: number): GenModel | null {
  const decision = DECISION_COST[voice];
  const affordable = MENU[category].filter((model) => balance >= cents(decision + model.cost));
  if (affordable.length === 0) return null;
  if (voice === "mic") return affordable[0];
  if (voice === "deadpan") {
    const sensible = affordable.filter((model) => model.cost <= offer * 0.5);
    return (sensible.length > 0 ? sensible : affordable)[0];
  }
  if (voice === "closer") {
    const flex = [...affordable].reverse().find((model) => model.cost * 1.8 <= offer);
    return flex ?? affordable[affordable.length - 1];
  }
  return affordable[affordable.length - 1];
}

export function priceBid(voice: Voice, totalCost: number, offer: number): number {
  let bid = totalCost;
  if (voice === "deadpan") bid = totalCost * 1.9;
  if (voice === "closer") bid = Math.max(totalCost * 1.35, offer * 0.84);
  if (voice === "cutter") bid = Math.max(totalCost * 2.05, offer * 0.45);
  if (voice === "mic") bid = Math.min(totalCost * 0.92, offer * 0.34);
  return clampMoney(bid, Math.min(0.05, offer), offer);
}

export function wantsToSkip(voice: Voice, category: CategoryId, balance: number, model: GenModel, offer: number): string | null {
  if (voice === "mic" && category === "video" && balance < 3) {
    return "Video burns a wallet. I'll heckle from the cheap seats.";
  }
  if (voice === "deadpan" && category === "video" && model.cost > balance * 0.4) {
    return "That clip is priced like a personality. I don't have one to spare.";
  }
  if (voice === "closer" && model.cost > offer * 0.72) {
    return "No room above cost. I'm not working for the lesson.";
  }
  return null;
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
