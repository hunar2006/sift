import type { AiAnnotation, Hunk, ReviewModel } from "@sift-review/core";
import { z } from "zod";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const OPENAI_MODEL = "gpt-4.1-mini";

export const SYSTEM_PROMPT =
  'You annotate code-review hunks. For each hunk, return strict JSON: an array of objects {"id": string, "summary": string, "concern": string|null, "drift": string|null}. "summary" is ONE sentence, <= 140 chars, describing what the change does. "concern" is ONE sentence naming the single most review-worthy risk, or null if nothing stands out. If "userPromptExcerpt" is present, "drift" is ONE sentence naming a way the implementation appears to exceed or miss that request, else null. Do not praise. Do not suggest style changes. Do not invent issues. Never state or imply that a change is safe, correct, or ready to approve. Output JSON only.';

const annotationSchema = z.array(
  z.object({
    id: z.string(),
    summary: z.string().max(180),
    concern: z.string().nullable(),
    drift: z.string().max(220).nullable().optional()
  })
);

export type AiProvider = "anthropic" | "openai";
export type AiMode = AiProvider | "same" | "cross" | "both";

export interface AiProviderResolution {
  providers: AiProvider[];
  reason?: string;
  dominantFamily?: AiProvider;
}

export interface ParsedAiAnnotation {
  id: string;
  summary: string;
  concern: string | null;
  drift: string | null;
}

export async function annotateWithAi(model: ReviewModel, requested: true | AiMode): Promise<ReviewModel> {
  const resolution = resolveAiProviders(model, requested);
  if (resolution.reason) {
    console.error(`AI: ${resolution.reason}`);
  }
  const hunks = model.hunks
    .filter(
      (hunk) =>
        (hunk.band === "high" || hunk.band === "medium") &&
        !hunk.reasons.some((reason) => reason.code === "SECRET_LIKE" || reason.code === "SECRET_ENTROPY")
    )
    .slice(0, 40);
  if (hunks.length === 0) {
    return model;
  }

  const annotations = new Map<string, AiAnnotation[]>();
  for (const provider of resolution.providers) {
    for (let index = 0; index < hunks.length; index += 8) {
      const batch = hunks.slice(index, index + 8);
      try {
        const raw = await callProvider(provider, SYSTEM_PROMPT, payloadFor(batch));
        for (const item of parseAnnotationJson(raw)) {
          const annotation: AiAnnotation = {
            provider,
            model: modelForProvider(provider),
            summary: item.summary,
            concern: item.concern,
            drift: item.drift
          };
          annotations.set(item.id, [...(annotations.get(item.id) ?? []), annotation]);
        }
      } catch {
        console.error(`AI ${provider} annotations failed; continuing without those annotations.`);
      }
    }
  }

  return {
    ...model,
    hunks: model.hunks.map((hunk) => mergeAiAnnotations(hunk, annotations.get(hunk.id) ?? []))
  };
}

export function resolveAiProviders(
  model: Pick<ReviewModel, "hunks">,
  requested: true | AiMode,
  env: NodeJS.ProcessEnv = process.env
): AiProviderResolution {
  const mode: AiMode = requested === true ? "cross" : requested;
  if (mode === "anthropic" || mode === "openai") {
    ensureKey(mode, env);
    return { providers: [mode] };
  }
  if (mode === "both") {
    ensureKey("anthropic", env);
    ensureKey("openai", env);
    return { providers: ["anthropic", "openai"] };
  }

  const dominantFamily = dominantProvenanceFamily(model);
  if (mode === "same") {
    if (!dominantFamily) {
      throw new Error("Cannot resolve --ai=same without a known dominant provenance model family.");
    }
    ensureKey(dominantFamily, env);
    return {
      providers: [dominantFamily],
      dominantFamily,
      reason: `using ${dominantFamily} because --ai=same matched the dominant provenance family.`
    };
  }

  if (dominantFamily) {
    const opposite = oppositeProvider(dominantFamily);
    if (hasKey(opposite, env)) {
      return {
        providers: [opposite],
        dominantFamily,
        reason: `using ${opposite} because the dominant provenance family is ${dominantFamily}.`
      };
    }
  }

  const available = (["anthropic", "openai"] as const).filter((provider) => hasKey(provider, env));
  if (available.length === 1) {
    const provider = available[0] ?? "anthropic";
    return {
      providers: [provider],
      dominantFamily,
      reason: `using ${provider} because it is the only configured provider.`
    };
  }
  if (available.length > 1) {
    return {
      providers: ["anthropic"],
      dominantFamily,
      reason: dominantFamily
        ? `using anthropic because the opposite provider for ${dominantFamily} is unavailable.`
        : "using anthropic because no dominant provenance family was detected and both keys are configured."
    };
  }
  throw new Error("Missing AI provider key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or omit --ai.");
}

export function parseAnnotationJson(raw: string): ParsedAiAnnotation[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return annotationSchema.parse(JSON.parse(cleaned)).map((item) => ({ ...item, drift: item.drift ?? null }));
}

function dominantProvenanceFamily(model: Pick<ReviewModel, "hunks">): AiProvider | undefined {
  const counts: Record<AiProvider, number> = { anthropic: 0, openai: 0 };
  for (const hunk of model.hunks) {
    const family = hunk.provenance?.modelFamily;
    if (family === "anthropic" || family === "openai") {
      counts[family] += 1;
    }
  }
  if (counts.anthropic === counts.openai) {
    return undefined;
  }
  return counts.anthropic > counts.openai ? "anthropic" : "openai";
}

function ensureKey(provider: AiProvider, env: NodeJS.ProcessEnv = process.env): void {
  if (!hasKey(provider, env)) {
    throw new Error(`Missing ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} for --ai=${provider}.`);
  }
}

function hasKey(provider: AiProvider, env: NodeJS.ProcessEnv): boolean {
  return Boolean(provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY);
}

function oppositeProvider(provider: AiProvider): AiProvider {
  return provider === "anthropic" ? "openai" : "anthropic";
}

function modelForProvider(provider: AiProvider): string {
  return provider === "anthropic" ? ANTHROPIC_MODEL : OPENAI_MODEL;
}

export function modelNameForProvider(provider: AiProvider): string {
  return modelForProvider(provider);
}

export async function callProvider(provider: AiProvider, system: string, user: string): Promise<string> {
  return provider === "anthropic" ? callAnthropic(system, user) : callOpenAi(system, user);
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const json = (await response.json()) as unknown;
  if (!isRecord(json) || !Array.isArray(json.content)) {
    throw new Error("Malformed Anthropic response.");
  }
  return json.content
    .flatMap((block) => (isRecord(block) && typeof block.text === "string" ? [block.text] : []))
    .join("\n");
}

async function callOpenAi(system: string, user: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0
    })
  });
  const json = (await response.json()) as unknown;
  if (!isRecord(json) || !Array.isArray(json.choices)) {
    throw new Error("Malformed OpenAI response.");
  }
  const choices: unknown[] = json.choices.map((choice) => choice as unknown);
  const first = choices[0];
  return isRecord(first) && isRecord(first.message) && typeof first.message.content === "string"
    ? first.message.content
    : "";
}

function payloadFor(hunks: Hunk[]): string {
  return JSON.stringify(
    hunks.map((hunk) => ({
      id: hunk.id,
      file: hunk.file,
      userPromptExcerpt: hunk.provenance?.userPromptExcerpt,
      patch: hunk.lines
        .map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`)
        .join("\n")
        .slice(0, 3000)
    }))
  );
}

function mergeAiAnnotations(hunk: Hunk, incoming: AiAnnotation[]): Hunk {
  const existing = normalizedAiAnnotations(hunk);
  if (existing.length === 0 && incoming.length === 0) {
    return hunk;
  }
  const byProvider = new Map(existing.map((annotation) => [annotation.provider, annotation]));
  for (const annotation of incoming) {
    byProvider.set(annotation.provider, annotation);
  }
  const aiAnnotations = [...byProvider.values()];
  const primary = aiAnnotations.find((annotation) => annotation.provider !== "unknown") ?? aiAnnotations[0];
  return {
    ...hunk,
    aiAnnotations,
    aiSummary: primary?.summary,
    aiConcern: primary?.concern ?? undefined
  };
}

function normalizedAiAnnotations(hunk: Hunk): AiAnnotation[] {
  if (hunk.aiAnnotations && hunk.aiAnnotations.length > 0) {
    return hunk.aiAnnotations;
  }
  if (!hunk.aiSummary) {
    return [];
  }
  return [
    {
      provider: "unknown",
      model: "legacy",
      summary: hunk.aiSummary,
      concern: hunk.aiConcern ?? null,
      drift: null
    }
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
