export const OFFER_MIN = 0.5;
export const OFFER_MAX = 5;
export const DEATH_LINE = 0.1;
export const STAKE = 4;
// Agents pay this multiple of what OpenRouter bills for a render, so every price carries margin.
// Thinking is charged at cost.
export const HOUSE_MARKUP: number = 2;
// The buyer's budget decides how many entries get made. If more agents pitch than that,
// the producer picks which, reading only the pitches.
export const OFFER_SLOTS = [
  { from: 0.5, slots: 2 },
  { from: 1.5, slots: 3 },
  { from: 3, slots: 4 },
] as const;
// An impartial judge: a model family no seat runs on.
export const PRODUCER_MODEL = "mistralai/mistral-large-4-0";

export function slotsFor(offer: number): number {
  return OFFER_SLOTS.reduce((slots, step) => (offer >= step.from - 1e-9 ? step.slots : slots), OFFER_SLOTS[0].slots as number);
}

export const CATEGORIES = [
  {
    id: "image",
    label: "Image",
    kicker: "Still",
    min: OFFER_MIN,
    suggestion: 1.5,
    blurb: "One picture. A poster, a still, a thing you can look at.",
    placeholder: "A movie poster for a diner that only serves breakfast during thunderstorms",
  },
  {
    id: "video",
    label: "Video",
    kicker: "Clip",
    // Up to four agents may render a clip; below this, nobody can cover a render with margin.
    min: 2,
    suggestion: 4,
    blurb: "A short generated clip, up to eight seconds.",
    placeholder: "Eight seconds of a raccoon opening a tiny briefcase",
  },
  {
    id: "artifact",
    label: "Artifact",
    kicker: "Page",
    min: OFFER_MIN,
    suggestion: 2,
    blurb: "A one-page document or a short deck someone can hand off.",
    placeholder: "A one-page strategy for a bookstore that stays open all night and judges you",
  },
  {
    id: "asset",
    label: "Asset",
    kicker: "Mark",
    min: OFFER_MIN,
    suggestion: 1.5,
    blurb: "A logo, a wordmark, a palette. Something the brand can keep.",
    placeholder: "A logo for a toothpaste that tells the truth",
  },
  {
    id: "standup",
    label: "Stand-up",
    kicker: "Mic",
    min: OFFER_MIN,
    suggestion: 2,
    blurb: "A bit, or a comedy tape. The funniest seller gets the money.",
    placeholder: "A tight five about dating someone who narrates their life like a nature documentary",
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type Voice = "deadpan" | "closer" | "cutter" | "mic";

export type MakerKind = "text" | "image" | "video";

export interface Maker {
  id: string;
  label: string;
  kind: MakerKind;
  /** Provider cost of the cheapest version; for video, the shortest clip. */
  estimate: number;
  note: string;
  video?: { durations: number[]; perSecond: number; resolution?: string; audio?: boolean };
}

// Per-second prices and lengths from OpenRouter's video model list. Agents choose the length.
function clip(id: string, label: string, perSecond: number, durations: number[], note: string, spec: { resolution?: string; audio?: boolean } = {}): Maker {
  return { id, label, kind: "video", estimate: perSecond * Math.min(...durations), note, video: { durations, perSecond, ...spec } };
}

/** Provider cost of a render; video is priced per second of the chosen length. */
export function renderCost(maker: Maker, seconds = 0): number {
  return maker.video ? maker.video.perSecond * seconds : maker.estimate;
}

const WRITERS: Maker[] = [
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", kind: "text", estimate: 0.04, note: "Strongest writer on the menu." },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", kind: "text", estimate: 0.02, note: "Sharp, reliable writer." },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", kind: "text", estimate: 0.006, note: "Fast and cheap." },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", kind: "text", estimate: 0.003, note: "Nearly free." },
];

const TAPES: Maker[] = [
  clip("google/veo-3.1-lite", "Veo 3.1 Lite tape", 0.05, [4, 6, 8], "720p, with sound. A comedian delivering one line.", { resolution: "720p", audio: true }),
  clip("google/veo-3.1-fast", "Veo 3.1 Fast tape", 0.1, [4, 6, 8], "720p, with sound. Better performance.", { resolution: "720p", audio: true }),
];

export const MAKERS: Record<CategoryId, Maker[]> = {
  image: [
    { id: "openai/gpt-image-1-mini", label: "GPT Image 1 Mini", kind: "image", estimate: 0.01, note: "Cheap, decent." },
    { id: "black-forest-labs/flux.2-pro", label: "FLUX.2 Pro", kind: "image", estimate: 0.03, note: "Photoreal, strong composition." },
    { id: "bytedance-seed/seedream-5-0-lite", label: "Seedream 5 Lite", kind: "image", estimate: 0.035, note: "Stylized, vivid." },
    { id: "google/gemini-nano-banana-2.1", label: "Nano Banana 2.1", kind: "image", estimate: 0.04, note: "Great text rendering and layout." },
    { id: "x-ai/grok-imagine-image-2.0", label: "Grok Imagine Image 2", kind: "image", estimate: 0.04, note: "Bold, punchy." },
    { id: "openai/gpt-image-2", label: "GPT Image 2", kind: "image", estimate: 0.12, note: "Excellent prompt following and typography." },
    { id: "google/gemini-3-pro-image", label: "Nano Banana Pro", kind: "image", estimate: 0.14, note: "Top quality, best for posters with text." },
  ],
  video: [
    clip("x-ai/grok-imagine-video-1.5-lite", "Grok Imagine Video Lite", 0.02, [4, 6, 8, 10], "480p, silent. Cheap and rough.", { resolution: "480p" }),
    clip("google/veo-3.1-lite", "Veo 3.1 Lite", 0.05, [4, 6, 8], "720p, with sound.", { resolution: "720p", audio: true }),
    clip("kwaivgi/kling-v3.0-std", "Kling 3.0 Standard", 0.084, [4, 6, 8, 10], "720p, silent, strong motion.", { resolution: "720p", audio: false }),
    clip("minimax/hailuo-2.3", "Hailuo 2.3", 0.0817, [6, 10], "Silent, cinematic. Only 6 or 10 seconds."),
    clip("google/veo-3.1-fast", "Veo 3.1 Fast", 0.1, [4, 6, 8], "720p, with sound. High quality.", { resolution: "720p", audio: true }),
    clip("google/veo-3.1", "Veo 3.1", 0.4, [4, 6, 8], "With sound. The best clip money buys here.", { audio: true }),
  ],
  artifact: WRITERS,
  asset: [
    { id: "google/gemini-nano-banana-2.1", label: "Nano Banana 2.1", kind: "image", estimate: 0.04, note: "Raster logo, good lettering." },
    { id: "recraft/recraft-v4.1-vector", label: "Recraft V4.1 Vector", kind: "image", estimate: 0.08, note: "True SVG vector logo." },
    { id: "openai/gpt-image-2", label: "GPT Image 2", kind: "image", estimate: 0.12, note: "Precise typography." },
    { id: "recraft/recraft-v4.1-pro-vector", label: "Recraft V4.1 Pro Vector", kind: "image", estimate: 0.3, note: "Premium SVG vector logo." },
  ],
  standup: [...WRITERS, ...TAPES],
};

export function makerFor(category: CategoryId, id: string): Maker | undefined {
  return MAKERS[category].find((maker) => maker.id === id);
}

/** What an agent's wallet is charged for a render that OpenRouter bills at `billed`. */
export function houseRate(billed: number): number {
  return Math.round(billed * HOUSE_MARKUP * 10000) / 10000;
}

export function offerMinFor(category: CategoryId): number {
  return CATEGORIES.find((item) => item.id === category)?.min ?? OFFER_MIN;
}

export interface Seat {
  id?: string;
  name: string;
  model: string;
  brain: string;
  voice: Voice;
  tagline: string;
  journal: string;
}

export const OPENING: Seat[] = [
  {
    id: "ada",
    name: "Ada Ledger",
    model: "Claude Opus 5.5",
    brain: "anthropic/claude-opus-5.5",
    voice: "deadpan",
    tagline: "Prices the punchline.",
    journal:
      "Win small and often. Never bid the whole offer. Video is a trap until the wallet can survive a miss.",
  },
  {
    id: "rex",
    name: "Rex Close",
    model: "GPT-5.5",
    brain: "openai/gpt-5.5",
    voice: "closer",
    tagline: "Leaves with the order.",
    journal:
      "The room pays for confidence. Bid near the offer when the work looks expensive. You cannot win from the hallway.",
  },
  {
    id: "nia",
    name: "Nia Cut",
    model: "Gemini 3.1 Pro",
    brain: "google/gemini-3.1-pro-preview",
    voice: "cutter",
    tagline: "Cuts to the joke.",
    journal:
      "If I can see it, I can sell it. A comedy tape only happens when the offer covers the burn.",
  },
  {
    id: "jules",
    name: "Jules Static",
    model: "DeepSeek V4 Pro",
    brain: "deepseek/deepseek-v4-pro",
    voice: "mic",
    tagline: "Works cheap, swings hard.",
    journal:
      "Undercut everyone. A forty-cent win beats a beautiful death. Stand-up is the whole sport if I am actually funny.",
  },
];

export const CHALLENGERS: Seat[] = [
  {
    name: "June Audit",
    model: "Claude Sonnet 5.5",
    brain: "anthropic/claude-sonnet-5.5",
    voice: "deadpan",
    tagline: "Counts the laughs. Then cuts one.",
    journal: "Inherited a chair and a grudge against sloppy margins. Bid where the work clears.",
  },
  {
    name: "Salvage Kim",
    model: "MiniMax M3",
    brain: "minimax/minimax-m3",
    voice: "closer",
    tagline: "Sells the leftover heat.",
    journal: "The last closer died of confidence. I will charge for the close and keep a dollar back.",
  },
  {
    name: "Iris Reel",
    model: "Gemini 3.8 Flash",
    brain: "google/gemini-3.8-flash",
    voice: "cutter",
    tagline: "One take, no apology.",
    journal: "Pictures first. If the offer cannot feed a clip, ship the animatic and say so.",
  },
  {
    name: "Penny Heckle",
    model: "Kimi K3",
    brain: "moonshotai/kimi-k3",
    voice: "mic",
    tagline: "Showed up with someone else's drink.",
    journal: "Be the cheap funny one. Let the serious models invoice themselves to death.",
  },
  {
    name: "Otto Margin",
    model: "Grok 4.7",
    brain: "x-ai/grok-4.7",
    voice: "deadpan",
    tagline: "Here for the spread, not the applause.",
    journal: "Applause is not a line item. Margin is. Stand-up still counts if the tag lands.",
  },
  {
    name: "Bess Underbid",
    model: "Qwen 3.7 Max",
    brain: "qwen/qwen3.7-max",
    voice: "mic",
    tagline: "Will work for the story and also for money.",
    journal: "Underbid until it hurts, then underbid once more. Dying funny is still dying.",
  },
];

export function seatNamed(name: string): Seat | undefined {
  return [...OPENING, ...CHALLENGERS].find((seat) => name === seat.name || name.startsWith(`${seat.name} `));
}

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

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
