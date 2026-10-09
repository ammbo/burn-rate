const BASE = "https://openrouter.ai/api/v1";

export interface OpenRouterEnv {
  OPENROUTER_API_KEY?: string;
  APP_ORIGIN?: string;
}

export function openrouterReady(env: OpenRouterEnv): boolean {
  return Boolean(env.OPENROUTER_API_KEY);
}

async function call(env: OpenRouterEnv, path: string, init: RequestInit, ms: number): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(ms),
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.APP_ORIGIN ?? "https://burnrateagents.com",
      "X-Title": "Burn Rate",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`OpenRouter ${path} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("Model did not return JSON");
  }
}

export interface Priced<T> {
  value: T;
  cost: number | null;
}

export async function chatJson<T>(
  env: OpenRouterEnv,
  model: string,
  system: string,
  user: string,
  name: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<Priced<T>> {
  try {
    return await chatOnce<T>(env, model, system, user, name, schema, maxTokens);
  } catch (error) {
    if (!(error instanceof EmptyReply)) throw error;
    const retry = await chatOnce<T>(env, model, system, user, name, schema, maxTokens);
    return { value: retry.value, cost: error.cost === null && retry.cost === null ? null : (error.cost ?? 0) + (retry.cost ?? 0) };
  }
}

class EmptyReply extends Error {
  constructor(message: string, readonly cost: number | null) {
    super(message);
  }
}

async function chatOnce<T>(
  env: OpenRouterEnv,
  model: string,
  system: string,
  user: string,
  name: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<Priced<T>> {
  const response = await call(env, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      reasoning: { effort: "low" },
      max_tokens: maxTokens,
      usage: { include: true },
    }),
  }, 150_000);
  const data = (await response.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[];
    usage?: { cost?: number };
  };
  const cost = typeof data.usage?.cost === "number" ? data.usage.cost : null;
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new EmptyReply(`${model} returned no content (${choice?.finish_reason ?? "no choice"}${choice?.message?.refusal ? `: ${choice.message.refusal.slice(0, 120)}` : ""})`, cost);
  return { value: parseJson<T>(content), cost };
}

export interface Picture {
  bytes: Uint8Array;
  type: string;
}

function decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function image(env: OpenRouterEnv, model: string, prompt: string, aspect: string): Promise<Priced<Picture>> {
  const response = await call(env, "/images", {
    method: "POST",
    body: JSON.stringify({ model, prompt: prompt.slice(0, 4000), aspect_ratio: aspect, n: 1 }),
  }, 180_000);
  const data = (await response.json()) as { data?: { b64_json?: string; media_type?: string }[]; usage?: { cost?: number } };
  const first = data.data?.[0];
  if (!first?.b64_json) throw new Error(`${model} returned no image`);
  return {
    value: { bytes: decode(first.b64_json), type: first.media_type ?? "image/png" },
    cost: typeof data.usage?.cost === "number" ? data.usage.cost : null,
  };
}

export interface VideoJob {
  id: string;
  status: string;
  pollingUrl: string;
  cost: number | null;
  error: string | null;
}

function videoJob(data: Record<string, unknown>, fallbackId = ""): VideoJob {
  const id = String(data.id ?? data.generation_id ?? fallbackId);
  const usage = data.usage as { cost?: number } | undefined;
  return {
    id,
    status: String(data.status ?? "pending"),
    pollingUrl: String(data.polling_url ?? `/api/v1/videos/${id}`),
    cost: typeof usage?.cost === "number" ? usage.cost : null,
    error: typeof data.error === "string" ? data.error : data.error ? JSON.stringify(data.error).slice(0, 300) : null,
  };
}

export async function submitVideo(
  env: OpenRouterEnv,
  model: string,
  prompt: string,
  options: { duration: number; resolution?: string; aspect: string; audio?: boolean },
): Promise<VideoJob> {
  const response = await call(env, "/videos", {
    method: "POST",
    body: JSON.stringify({
      model,
      prompt: prompt.slice(0, 2000),
      duration: options.duration,
      aspect_ratio: options.aspect,
      ...(options.resolution ? { resolution: options.resolution } : {}),
      ...(options.audio === undefined ? {} : { generate_audio: options.audio }),
    }),
  }, 60_000);
  return videoJob((await response.json()) as Record<string, unknown>);
}

export async function pollVideo(env: OpenRouterEnv, job: VideoJob): Promise<VideoJob> {
  const url = new URL(job.pollingUrl, "https://openrouter.ai").toString();
  const response = await call(env, url, { method: "GET" }, 30_000);
  return videoJob((await response.json()) as Record<string, unknown>, job.id);
}

export async function downloadVideo(env: OpenRouterEnv, job: VideoJob): Promise<ArrayBuffer> {
  const response = await call(env, `/videos/${job.id}/content?index=0`, { method: "GET" }, 120_000);
  return response.arrayBuffer();
}
