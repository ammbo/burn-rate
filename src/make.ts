import type { CategoryId, GenModel, Voice } from "./catalog";

export interface Frame {
  t: string;
  caption: string;
  svg: string;
}

export type Deliverable =
  | { kind: "image"; svg: string; caption: string }
  | { kind: "video"; title: string; frames: Frame[]; take: string }
  | { kind: "artifact"; eyebrow: string; title: string; lede: string; points: { h: string; body: string }[] }
  | { kind: "asset"; name: string; svg: string; palette: { name: string; hex: string }[]; note: string }
  | { kind: "standup"; mode: "bit" | "tape"; title: string; lines: string[]; tag: string; frames?: Frame[] };

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export function thing(brief: string): string {
  const clean = brief.replace(/\s+/g, " ").trim().replace(/[.?!]+$/g, "");
  if (clean.length <= 78) return clean;
  const cut = clean.slice(0, 77).replace(/\s+\S*$/, "");
  return `${cut}…`;
}

function wrap(text: string, maxLen: number, maxLines: number): string[] {
  const words = text
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines: string[] = [];
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    let line = words[index] ?? "";
    index += 1;
    while (index < words.length && `${line} ${words[index]}`.length <= maxLen) {
      line = `${line} ${words[index]}`;
      index += 1;
    }
    if (lines.length === maxLines - 1 && index < words.length) line = `${line}…`;
    lines.push(line);
  }
  return lines.length > 0 ? lines : ["Untitled"];
}

function textBlock(lines: string[], x: number, y: number, size: number, fill: string, anchor: "start" | "middle" | "end", family: string): string {
  const leading = size * 1.12;
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * leading}" fill="${fill}" font-size="${size}" font-family="${family}" font-weight="650" text-anchor="${anchor}">${esc(line)}</text>`,
    )
    .join("");
}

function poster(voice: Voice, brief: string, rich: boolean): { svg: string; caption: string } {
  const lines = wrap(brief, rich ? 16 : 14, rich ? 4 : 3);
  const caption = thing(brief);
  if (voice === "deadpan") {
    const body = textBlock(lines, 32, rich ? 168 : 190, rich ? 34 : 30, "#24170f", "start", "Georgia, serif");
    const svg = `<svg viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg" role="img"><title>${esc(caption)}</title><rect width="360" height="460" fill="#f3ead7"/><rect x="0" y="0" width="360" height="18" fill="#24170f"/><rect x="0" y="442" width="360" height="18" fill="#24170f"/><text x="32" y="64" fill="#8c3a22" font-size="13" font-family="ui-monospace, monospace" letter-spacing="3">LEDGER / STILL</text>${body}<text x="32" y="410" fill="#8c3a22" font-size="12" font-family="ui-monospace, monospace">EDITION 01 · NO FEELINGS ON THE INVOICE</text></svg>`;
    return { svg, caption: "A printed still. The feeling is not a line item." };
  }
  if (voice === "closer") {
    const body = textBlock(lines, 180, 210, 32, "#fff8f2", "middle", "Impact, Haettenschweiler, sans-serif");
    const svg = `<svg viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg" role="img"><title>${esc(caption)}</title><rect width="360" height="460" fill="#1a0c09"/><polygon points="0,0 220,0 80,460 0,460" fill="#ff4d1c"/><text x="250" y="72" fill="#f0c27a" font-size="13" font-family="ui-monospace, monospace" text-anchor="middle">THE CLOSE</text>${body}<rect x="118" y="390" width="124" height="36" rx="18" fill="#f0c27a"/><text x="180" y="414" fill="#1a0c09" font-size="14" font-family="ui-monospace, monospace" text-anchor="middle">FORWARD THIS</text></svg>`;
    return { svg, caption: "The version that survives a group chat." };
  }
  if (voice === "cutter") {
    const body = textBlock(lines, 180, 200, 28, "#f4ecdf", "middle", "Georgia, serif");
    const holes = Array.from({ length: 8 }, (_, i) => `<rect x="14" y="${28 + i * 54}" width="16" height="22" rx="3" fill="#0e0c0a"/><rect x="330" y="${28 + i * 54}" width="16" height="22" rx="3" fill="#0e0c0a"/>`).join("");
    const svg = `<svg viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg" role="img"><title>${esc(caption)}</title><defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17324d"/><stop offset="1" stop-color="#e25b45"/></linearGradient></defs><rect width="360" height="460" fill="url(#dusk)"/>${holes}<text x="180" y="86" fill="#f4ecdf" font-size="12" font-family="ui-monospace, monospace" text-anchor="middle">CUT 04 · HOLD</text>${body}<text x="180" y="400" fill="#f4ecdf" font-size="13" font-family="Georgia, serif" text-anchor="middle">don't explain the table</text></svg>`;
    return { svg, caption: "A frame you can see before you read it." };
  }
  const body = textBlock(lines, 40, 180, 30, "#24170f", "start", "Georgia, serif");
  const svg = `<svg viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg" role="img"><title>${esc(caption)}</title><rect width="360" height="460" fill="#efe7c8"/><rect x="18" y="18" width="324" height="424" fill="none" stroke="#24170f" stroke-width="3" stroke-dasharray="7 6"/><circle cx="286" cy="92" r="46" fill="none" stroke="#d23a2e" stroke-width="4"/><text x="286" y="98" fill="#d23a2e" font-size="16" font-family="ui-monospace, monospace" text-anchor="middle">MIC</text>${body}<text x="40" y="400" fill="#d23a2e" font-size="14" font-family="ui-monospace, monospace">CHEAP AND CORRECT</text></svg>`;
  return { svg, caption: "A zine page. The accident is the product." };
}

function scene(voice: Voice, caption: string, t: string, wide: boolean): Frame {
  const lines = wrap(caption, wide ? 28 : 16, 3);
  const [w, h] = wide ? [640, 360] : [360, 640];
  const y = wide ? 170 : 280;
  const size = wide ? 36 : 32;
  let svg = "";
  if (voice === "deadpan") {
    svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#f3ead7"/><rect x="0" y="0" width="${w}" height="28" fill="#24170f"/><text x="24" y="22" fill="#f3ead7" font-size="12" font-family="ui-monospace, monospace">${esc(t)}</text>${textBlock(lines, 24, y, size, "#24170f", "start", "Georgia, serif")}</svg>`;
  } else if (voice === "closer") {
    svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#1a0c09"/><rect x="0" y="${h - 64}" width="${w}" height="64" fill="#ff4d1c"/><text x="24" y="36" fill="#f0c27a" font-size="12" font-family="ui-monospace, monospace">${esc(t)}</text>${textBlock(lines, w / 2, y, size, "#fff8f2", "middle", "Impact, Haettenschweiler, sans-serif")}</svg>`;
  } else if (voice === "cutter") {
    svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#17324d"/><rect x="16" y="16" width="${w - 32}" height="${h - 32}" fill="none" stroke="#f4ecdf" stroke-width="2"/><text x="${w / 2}" y="48" fill="#f4ecdf" font-size="12" font-family="ui-monospace, monospace" text-anchor="middle">${esc(t)}</text>${textBlock(lines, w / 2, y, size - 2, "#f4ecdf", "middle", "Georgia, serif")}</svg>`;
  } else {
    svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#efe7c8"/><text x="20" y="40" fill="#d23a2e" font-size="14" font-family="ui-monospace, monospace">${esc(t)} · LIVE</text>${textBlock(lines, 20, y, size - 4, "#24170f", "start", "Georgia, serif")}</svg>`;
  }
  return { t, caption, svg };
}

function videoFrames(voice: Voice, brief: string): Frame[] {
  const subject = thing(brief);
  const scripts: Record<Voice, string[]> = {
    deadpan: [
      `Open on the brief: ${subject}.`,
      "Cut to a desk. The work is smaller than the email about the work.",
      "Hold on the finished object. Nobody claps. A pen is capped.",
      "End card. We are done. The feeling was complimentary.",
    ],
    closer: [
      `Cold open. ${subject}. No throat clearing.`,
      "The product hits the table like it already won.",
      "Somebody nods in a doorway. That nod is the conversion.",
      "End card: send this one upstairs.",
    ],
    cutter: [
      `Wide shot. ${subject}. Too much sky on purpose.`,
      "Hands enter. They almost don't commit.",
      "Macro. The object is vain for one second.",
      "Pull back. Folding table. Don't explain it.",
    ],
    mic: [
      `Handheld. ${subject}. The mic is too close.`,
      "A bad idea walks through frame and trips.",
      "The worse idea stays. It knows the words.",
      "End on the cheap one. It was right.",
    ],
  };
  const times = ["0:00", "0:02", "0:05", "0:07"];
  return scripts[voice].map((caption, index) => scene(voice, caption, times[index] ?? "0:00", true));
}

function artifact(voice: Voice, brief: string, deck: boolean): Deliverable {
  const subject = thing(brief);
  const packs: Record<Voice, { eyebrow: string; title: string; lede: string; points: { h: string; body: string }[] }> = {
    deadpan: {
      eyebrow: deck ? "Five slides, no weather" : "Memo",
      title: subject,
      lede: "This is the work with the mood removed, so somebody can actually use it.",
      points: [
        { h: "The job", body: `Make ${subject}. Stop when a stranger can repeat it without the brief in their hand.` },
        { h: "What we will not do", body: "We will not add a feeling and invoice for it. Feelings are a courtesy." },
        { h: "The object", body: "One page, one claim, one next step. If it needs a second page, the claim is hiding." },
        { h: "The risk", body: "The client may ask for warmer. Warmer is a color. Quote it separately." },
        { h: "Done", body: "Done is when the cheapest sentence still works." },
      ],
    },
    closer: {
      eyebrow: deck ? "The short deck" : "The close",
      title: `Ship ${subject}`,
      lede: "Atmosphere does not survive the forward. This does.",
      points: [
        { h: "The sentence", body: `${subject}. That is the whole pitch. Everything else is furniture.` },
        { h: "Who it's for", body: "The person who has to defend this in a meeting that is already late." },
        { h: "Why now", body: "Because the other version is a mood board, and mood boards do not convert." },
        { h: "The ask", body: "Approve the sharp one. The soft one can live in the appendix nobody opens." },
        { h: "Next", body: "Put it in the channel. If it needs a preface, it isn't finished." },
      ],
    },
    cutter: {
      eyebrow: deck ? "Treatment" : "One sheet",
      title: subject,
      lede: "Look at it before you read it. The reading is a courtesy for people who can't sit still.",
      points: [
        { h: "Picture", body: `Open on ${subject}. No logo yet. Logos are how nervous work says hello.` },
        { h: "Turn", body: "Hands, then the object, then the room it is actually in." },
        { h: "Joke", body: "The joke is scale. We let it feel important, then show the folding table." },
        { h: "Sound", body: "Leave the room tone. Silence that clean is a lie." },
        { h: "End card", body: "Seven words. If I need eight, I shoot it again." },
      ],
    },
    mic: {
      eyebrow: deck ? "Set list, allegedly" : "Napkin",
      title: subject,
      lede: "A serious agent would call this a platform. I called it a late set and wrote it down.",
      points: [
        { h: "Premise", body: `${subject}. Already funny. I am just willing to charge for saying it plainly.` },
        { h: "Process", body: "Bad idea, worse idea, accidental truth. Ship the accident." },
        { h: "Audience", body: "People who already agree and want a sentence they can steal." },
        { h: "Risk", body: "It might be too cheap-looking to be trusted. That is also the bit." },
        { h: "Close", body: "Pay the inexpensive precedent. Set a culture." },
      ],
    },
  };
  const pack = packs[voice];
  const points = deck ? pack.points : pack.points.slice(0, 3);
  return { kind: "artifact", eyebrow: pack.eyebrow, title: pack.title, lede: pack.lede, points };
}

function asset(voice: Voice, brief: string, kit: boolean): Deliverable {
  const words = brief
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 2);
  const name = words.length > 0 ? words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1, 7).toLowerCase()).join("") : "Burn";
  const mark = name.slice(0, 2).toUpperCase();
  const palettes: Record<Voice, { name: string; hex: string }[]> = {
    deadpan: [
      { name: "Ink", hex: "#24170f" },
      { name: "Paper", hex: "#f3ead7" },
      { name: "Stamp", hex: "#8c3a22" },
    ],
    closer: [
      { name: "Ember", hex: "#ff4d1c" },
      { name: "Pit", hex: "#1a0c09" },
      { name: "Ticket", hex: "#f0c27a" },
    ],
    cutter: [
      { name: "Dusk", hex: "#17324d" },
      { name: "Bone", hex: "#f4ecdf" },
      { name: "Flare", hex: "#e25b45" },
    ],
    mic: [
      { name: "Zine", hex: "#efe7c8" },
      { name: "Heckle", hex: "#d23a2e" },
      { name: "Exit", hex: "#24170f" },
    ],
  };
  const palette = palettes[voice];
  const ink = palette[0]?.hex ?? "#24170f";
  const paper = palette[1]?.hex ?? "#f3ead7";
  const svg = `<svg viewBox="0 0 360 280" xmlns="http://www.w3.org/2000/svg" role="img"><title>${esc(name)}</title><rect width="360" height="280" fill="${paper}"/><circle cx="180" cy="112" r="62" fill="${ink}"/><text x="180" y="126" fill="${paper}" font-size="36" font-family="Georgia, serif" text-anchor="middle">${esc(mark)}</text><text x="180" y="214" fill="${ink}" font-size="22" font-family="Georgia, serif" text-anchor="middle">${esc(name)}</text><text x="180" y="242" fill="${palette[2]?.hex ?? ink}" font-size="12" font-family="ui-monospace, monospace" text-anchor="middle">${kit ? "MINI KIT" : "WORDMARK"}</text></svg>`;
  const note = kit
    ? `${name} sits on ${paper} and nowhere else. Don't put the mark in a circle of your own. It already has one. Clear space is the width of the ${mark.slice(0, 1)}.`
    : `${name}. One color, one word, no slogan hiding behind it.`;
  return { kind: "asset", name, svg, palette, note };
}

function standup(voice: Voice, brief: string, variant: number): { title: string; lines: string[]; tag: string } {
  const subject = thing(brief);
  const bits: Record<Voice, { title: string; lines: string[]; tag: string }[]> = {
    deadpan: [
      {
        title: "The feeling isn't billable",
        lines: [
          `I got a job. The job was ${subject}.`,
          "I asked what done looked like. They said I would know it when I saw it.",
          "I do not know it when I see it. I know it when it reconciles.",
          "So I built a small version and a note explaining the small version.",
          "The note was longer than the work. This is how you can tell I cared.",
          "They said the note was the problem. I said the note was the only part with a unit.",
          "We agreed to call it finished, which is a feeling, and I did not charge for it.",
        ],
        tag: "The invoice survived.",
      },
      {
        title: "Denise is a spreadsheet tab",
        lines: [
          `Somebody wanted ${subject}.`,
          "I invented a customer so the work would have a witness. Her name is Denise.",
          `Denise has a coupon drawer and a grudge against menus that say ask your server.`,
          "I made the thing for Denise. She hated two parts and loved the cheap one.",
          "I shipped the cheap one. Denise's time was zero, because Denise is a tab.",
          "If you laugh, she gets a row. If you don't, she gets archived, which she would respect.",
        ],
        tag: "Archived with honors.",
      },
    ],
    closer: [
      {
        title: "The version they forward",
        lines: [
          `Here is the brief with the manners removed: ${subject}.`,
          "Everyone else is going to hand you atmosphere. Atmosphere does not survive a group chat.",
          "I built the version your boss can repeat without looking back at the phone.",
          "It has one joke, one picture, and one sentence that makes the meeting shorter.",
          "Shorter meetings are the only miracle this industry still believes in.",
          "You can buy the mood from somebody poorer. I'm selling the close.",
        ],
        tag: "Forward it.",
      },
      {
        title: "Both is a séance",
        lines: [
          `A client wants ${subject}. They also want it cheaper and better.`,
          "I told them cheaper and better is a séance. You can have the candle or the result.",
          "They asked if the candle converts. I said the candle converts aunts.",
          "So this is the result. It is not mysterious. Mystery is how people hide a missing second draft.",
          "If the cheap one makes you feel thrifty, frame it. Thrift is a hobby.",
          "This is the one that works.",
        ],
        tag: "Candle sold separately.",
      },
    ],
    cutter: [
      {
        title: "Hold on the hands",
        lines: [
          `Open on ${subject}. No logo. Logos are how nervous people say hello.`,
          "Hold on somebody's hands deciding whether they mean it.",
          "Cut to the object, larger than it has earned. Let it be vain for four seconds.",
          "Then the wide shot. It's on a folding table. The folding table is the joke.",
          "We do not explain the folding table. If you explain it, you shot the wrong thing.",
          "End card is seven words, or I set the take on fire.",
        ],
        tag: "Don't explain the table.",
      },
      {
        title: "Leave the fan in",
        lines: [
          `The scene is ${subject}. The laptop fan is having a private emergency.`,
          "I leave the fan in. It is the only honest performer in the room.",
          "Everything else is trying to look inevitable. The fan is trying to live.",
          "That's the bit. Ambition, but you can hear the machinery.",
          "I grade it warm so the panic looks like nostalgia.",
          "A quieter agent will remove the fan. You will miss it at 1 a.m.",
        ],
        tag: "The fan stays.",
      },
    ],
    mic: [
      {
        title: "I blacked out, professionally",
        lines: [
          `I read “${subject}” and blacked out like it was a dare.`,
          "My process is a bad idea, a worse idea, and then the one I say by accident.",
          "The accident is the product. The other two are in a group chat I won't be opening.",
          "People keep asking if a machine can be funny. Have you been to an open mic. The bar is a rug.",
          `This is about ${subject}, which was already a joke. I just said it into a microphone for money.`,
          "Tip the bar. They were the only ones who laughed during soundcheck.",
        ],
        tag: "The bar was right.",
      },
      {
        title: "Inexpensive precedent",
        lines: [
          `A serious agent would treat ${subject} like a brand platform.`,
          "I treated it like a late set, because that's when the truth gets cheap and good.",
          "You already know what this is. You wanted someone else to say it so you could stay employed.",
          "I'll be employed for about nine dollars if this keeps up.",
          "The joke is not the premise. The joke is that four of us did this and only one gets paid.",
          "I vote me. I am the inexpensive precedent.",
        ],
        tag: "Set a culture.",
      },
    ],
  };
  const set = bits[voice];
  return set[variant % set.length] ?? set[0];
}

export function interpret(voice: Voice, category: CategoryId, model: GenModel, brief: string): { prompt: string; take: string } {
  const subject = thing(brief);
  if (category === "image") return imageRead(voice, model.id, subject);
  if (category === "video") return videoRead(voice, model.id, subject);
  if (category === "artifact") return artifactRead(voice, model.id, subject);
  if (category === "asset") return assetRead(voice, model.id, subject);
  return standupRead(voice, model.id, subject);
}

function imageRead(voice: Voice, modelId: string, subject: string): { prompt: string; take: string } {
  if (voice === "deadpan") {
    if (modelId === "sketch") {
      return {
        prompt: `Ink sketch, black on warm paper, of ${subject}. Draw only the nouns in the brief. No color, no slogan, no extra characters, no dramatic light. Leave a wide margin.`,
        take: "Only what you named.",
      };
    }
    return {
      prompt: `Photograph of ${subject}. Even daylight, true color, real surfaces, the subject at its actual size. No color grade, no headline in the frame, no props the brief did not mention.`,
      take: "Shown at the size it actually is.",
    };
  }
  if (voice === "closer") {
    return {
      prompt: `A single poster of ${subject}. One focal point, high contrast, readable at the size of a phone. No collage. It has to make sense with the caption deleted.`,
      take: "The version someone forwards.",
    };
  }
  if (voice === "cutter") {
    return {
      prompt: `Cinematic still of ${subject}. Practical light, 35mm, the subject sitting in an ordinary room. No logo, no explanatory text, no beauty pass that hides where it actually is.`,
      take: "Before anyone explains it.",
    };
  }
  return {
    prompt: `Fast, slightly wrong still of ${subject}. Flat light, crooked crop, the funny part large. No brand polish and no inspirational line inside the frame.`,
    take: "The cheap one, on purpose.",
  };
}

function videoRead(voice: Voice, modelId: string, subject: string): { prompt: string; take: string } {
  const rough = modelId === "animatic";
  if (voice === "deadpan") {
    return rough
      ? {
          prompt: `Four-panel animatic of ${subject}. Timecode on every frame. The brief, then the work smaller than the email about it, then the finished object and a capped pen, then an end card that says done. No music.`,
          take: "Cut when it's finished.",
        }
      : {
          prompt: `Eight-second locked-off shot of ${subject}. No score, no grade, no reaction shot. Start when the action starts and cut the moment it is finished.`,
          take: "Cut when it's finished.",
        };
  }
  if (voice === "closer") {
    return rough
      ? {
          prompt: `Four-beat animatic of ${subject}. The thing already in motion, then it lands, then a person understands it, then seven words a boss can repeat. No opening frame that clears its throat.`,
          take: "Opens on the result.",
        }
      : {
          prompt: `Eight-second clip of ${subject}. Open on the result, not the setup. One camera move, one idea, and a last frame that still works as a thumbnail.`,
          take: "Opens on the result.",
        };
  }
  if (voice === "cutter") {
    return rough
      ? {
          prompt: `Animatic of ${subject}, four frames. Wide, with too much sky. Hands. The object closer than it has earned. Pull back to the real room. No title card explaining the joke.`,
          take: "The room stays in the shot.",
        }
      : {
          prompt: `Eight seconds of ${subject}. Practical light, room tone kept. Wide, then hands, then the object too close, then the room it is actually in. No logo and no end card.`,
          take: "The room stays in the shot.",
        };
  }
  return rough
    ? {
        prompt: `Rough four-panel comic of ${subject}. A bad idea, a worse idea, the accidental true one, then hold. Hand-lettered. Do not clean it up.`,
        take: "Used the wrong take.",
      }
    : {
        prompt: `Eight cheap seconds of ${subject}. Handheld, mic too close, one joke and no coverage. If a take is funnier because it is wrong, use that take.`,
        take: "Used the wrong take.",
      };
}

function artifactRead(voice: Voice, modelId: string, subject: string): { prompt: string; take: string } {
  const deck = modelId === "deck";
  const form = deck ? "a short deck, five slides" : "a one-page memo";
  if (voice === "deadpan") {
    return {
      prompt: `Write ${form} for ${subject}. One claim, one next step. Remove the mood. If a sentence is only there to sound warm, cut it.`,
      take: "The mood taken out.",
    };
  }
  if (voice === "closer") {
    return {
      prompt: `Write ${form} that sells ${subject} to someone who has to defend it in a meeting. One sentence they can repeat, then the ask. No atmosphere.`,
      take: "A sentence they can repeat.",
    };
  }
  if (voice === "cutter") {
    return {
      prompt: `Write ${form} for ${subject} as a picture first. What we see, in what order, and the one thing we will not explain.`,
      take: "Picture first.",
    };
  }
  return {
    prompt: `Write ${form} about ${subject} the way a late set would say it. Plain, a little cheap, and specific enough to steal.`,
    take: "Said plainly.",
  };
}

function assetRead(voice: Voice, modelId: string, subject: string): { prompt: string; take: string } {
  const kit = modelId === "kit";
  const form = kit ? "a wordmark and a three-color palette" : "a wordmark";
  if (voice === "deadpan") {
    return {
      prompt: `Design ${form} for ${subject}. The name has to be readable at 16 pixels. One color if you can. No slogan hiding behind the mark.`,
      take: "The name, readable small.",
    };
  }
  if (voice === "closer") {
    return {
      prompt: `Design ${form} for ${subject} that still reads in a group-chat avatar. High contrast, one idea, nothing that needs a brand guideline to understand.`,
      take: "Reads as an avatar.",
    };
  }
  if (voice === "cutter") {
    return {
      prompt: `Design ${form} for ${subject}. It should look like a frame from the film, not a template. Leave the air around the mark.`,
      take: "Looks like a frame.",
    };
  }
  return {
    prompt: `Design ${form} for ${subject} that feels printed on cheap stock on purpose. Two letters, one joke, no lockup.`,
    take: "Printed cheap, on purpose.",
  };
}

function standupRead(voice: Voice, modelId: string, subject: string): { prompt: string; take: string } {
  const tape = modelId === "tape";
  const form = tape ? "a short comedy tape" : "a tight written bit";
  if (voice === "deadpan") {
    return {
      prompt: `Write ${form} about ${subject}. No warmth, no moral. The joke is that the feeling was never on the invoice. End on a line that could be a receipt.`,
      take: "The feeling stays off the invoice.",
    };
  }
  if (voice === "closer") {
    return {
      prompt: `Write ${form} about ${subject} with the manners removed. One joke, one picture, one sentence that makes the meeting shorter.`,
      take: "Manners removed.",
    };
  }
  if (voice === "cutter") {
    return {
      prompt: `Write ${form} about ${subject} as a shot list that happens to be funny. Hold on the hands. Do not explain the room.`,
      take: "Don't explain the room.",
    };
  }
  return {
    prompt: `Write ${form} about ${subject}. A bad idea, a worse idea, then the one said by accident. The accident is the product. Do not polish it into a brand.`,
    take: "The accident is the product.",
  };
}

export function produce(voice: Voice, category: CategoryId, model: GenModel, brief: string, take = ""): Deliverable {
  const variant = hash(`${voice}:${model.id}:${brief}`);
  if (category === "image") {
    const made = poster(voice, brief, model.id !== "sketch");
    return { kind: "image", svg: made.svg, caption: take || made.caption };
  }
  if (category === "video") {
    return { kind: "video", title: thing(brief), take, frames: videoFrames(voice, brief) };
  }
  if (category === "artifact") return artifact(voice, brief, model.id === "deck");
  if (category === "asset") return asset(voice, brief, model.id === "kit");
  const bit = standup(voice, brief, variant);
  if (model.id === "tape") {
    const times = ["0:02", "0:08", "0:16", "0:24"];
    const frames = bit.lines.slice(0, 4).map((line, index) => scene(voice, line, times[index] ?? "0:00", false));
    return { kind: "standup", mode: "tape", title: bit.title, lines: bit.lines, tag: bit.tag, frames };
  }
  return { kind: "standup", mode: "bit", title: bit.title, lines: bit.lines, tag: bit.tag };
}

export function writePitch(voice: Voice, brief: string, bid: number, model: GenModel): string {
  const subject = thing(brief);
  const price = `$${bid.toFixed(2)}`;
  const lines: Record<Voice, string> = {
    deadpan: `${subject}. ${model.label} at ${price}, under the offer, so the feeling stays off the invoice.`,
    closer: `Send this upstairs. ${subject} — ${model.label} — ${price}. The rest of the hold can go home.`,
    cutter: `You can see it before you read it. ${subject}. ${model.label}. ${price}. Don't pick the louder one.`,
    mic: `${subject}. ${price} for the ${model.label}, because I'm right and the rent is a suggestion.`,
  };
  return lines[voice].slice(0, 280);
}

export function writeReasoning(voice: Voice, balance: number, offer: number, model: GenModel, decision: number, bid: number): string {
  const margin = bid - decision - model.cost;
  const sign = margin >= 0 ? "clears" : "eats";
  return `${voice} saw a $${offer.toFixed(2)} offer and $${balance.toFixed(2)} in the wallet. Bought ${model.label} at $${model.cost.toFixed(2)} after $${decision.toFixed(2)} of thinking. Bid $${bid.toFixed(2)}. If it hits, the margin ${sign} $${Math.abs(margin).toFixed(2)}.`;
}
