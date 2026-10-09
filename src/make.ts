import type { Writing } from "./ai";
import type { CategoryId, Voice } from "./catalog";

export interface Frame {
  t: string;
  caption: string;
  svg: string;
}

export type Deliverable =
  | { kind: "image"; svg: string; caption: string; src?: string }
  | { kind: "video"; title: string; frames: Frame[]; take: string; src?: string }
  | { kind: "artifact"; eyebrow: string; title: string; lede: string; points: { h: string; body: string }[] }
  | { kind: "asset"; name: string; svg: string; palette: { name: string; hex: string }[]; note: string; src?: string }
  | { kind: "standup"; mode: "bit" | "tape"; title: string; lines: string[]; tag: string; frames?: Frame[]; src?: string };

export function thing(brief: string): string {
  const clean = brief.replace(/\s+/g, " ").trim().replace(/[.?!]+$/g, "");
  if (clean.length <= 78) return clean;
  const cut = clean.slice(0, 77).replace(/\s+\S*$/, "");
  return `${cut}…`;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function clipList(value: unknown, max: number, count: number): string[] {
  return Array.isArray(value) ? value.map((item) => clip(item, max)).filter(Boolean).slice(0, count) : [];
}

export function fromWriting(brief: string, writing: Writing): Deliverable | null {
  if (writing.kind === "artifact") {
    const points = Array.isArray(writing.points)
      ? writing.points.map((point) => ({ h: clip(point?.h, 60), body: clip(point?.body, 300) })).filter((point) => point.h && point.body).slice(0, 5)
      : [];
    if (points.length === 0) return null;
    return { kind: "artifact", eyebrow: clip(writing.eyebrow, 40), title: clip(writing.title, 90) || thing(brief), lede: clip(writing.lede, 300), points };
  }
  const lines = clipList(writing.lines, 240, 8);
  if (lines.length < 3) return null;
  return { kind: "standup", mode: "bit", title: clip(writing.title, 80) || "Untitled", lines, tag: clip(writing.tag, 60) };
}

export function fromMedia(category: CategoryId, kind: "image" | "video", src: string, take: string, brief: string): Deliverable {
  const title = clip(take, 90) || thing(brief);
  if (kind === "video") {
    if (category === "standup") return { kind: "standup", mode: "tape", title, lines: [], tag: "", src };
    return { kind: "video", title, take: title, frames: [], src };
  }
  if (category === "asset") return { kind: "asset", name: title, svg: "", palette: [], note: "", src };
  return { kind: "image", svg: "", caption: title, src };
}

// Fallback pitch when an agent's plan leaves the pitch empty.
export function writePitch(voice: Voice, brief: string, bid: number, made: string): string {
  const subject = thing(brief);
  const price = `$${bid.toFixed(2)}`;
  const lines: Record<Voice, string> = {
    deadpan: `${subject}. ${made} at ${price}, under the offer, so the feeling stays off the invoice.`,
    closer: `Send this upstairs. ${subject} — ${made} — ${price}. The rest of the hold can go home.`,
    cutter: `You can see it before you read it. ${subject}. ${made}. ${price}. Don't pick the louder one.`,
    mic: `${subject}. ${price} for the ${made}, because I'm right and the rent is a suggestion.`,
  };
  return lines[voice].slice(0, 280);
}
