import type { Hunk, ReviewModel } from "@sift-review/core";
import { z } from "zod";

const SYSTEM_PROMPT =
  'You annotate code-review hunks. For each hunk, return strict JSON: an array of objects {"id": string, "summary": string, "concern": string|null}. "summary" is ONE sentence, ≤ 140 chars, describing what the change does. "concern" is ONE sentence naming the single most review-worthy risk, or null if nothing stands out. Do not praise. Do not suggest style changes. Do not invent issues. Output JSON only.';

const annotationSchema = z.array(
  z.object({
    id: z.string(),
    summary: z.string().max(180),
    concern: z.string().nullable()
  })
);

export type AiProvider = "anthropic" | "openai";

export async function annotateWithAi(model: ReviewModel, requested: true | AiProvider): Promise<ReviewModel> {
  const provider = resolveProvider(requested);
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
  const annotations = new Map<string, { summary: string; concern: string | null }>();
  for (let index = 0; index < hunks.length; index += 8) {
    const batch = hunks.slice(index, index + 8);
    try {
      const raw = provider === "anthropic" ? await callAnthropic(batch) : await callOpenAi(batch);
      for (const item of parseAnnotationJson(raw)) {
        annotations.set(item.id, { summary: item.summary, concern: item.concern });
      }
    } catch {
      console.error("AI annotations failed; continuing without annotations.");
    }
  }
  return {
    ...model,
    hunks: model.hunks.map((hunk) => {
      const annotation = annotations.get(hunk.id);
      return annotation ? { ...hunk, aiSummary: annotation.summary, aiConcern: annotation.concern ?? undefined } : hunk;
    })
  };
}

function resolveProvider(requested: true | AiProvider): AiProvider {
  if (requested !== true) {
    ensureKey(requested);
    return requested;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  throw new Error("Missing AI provider key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or omit --ai.");
}

function ensureKey(provider: AiProvider): void {
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY for --ai=anthropic.");
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for --ai=openai.");
  }
}

async function callAnthropic(hunks: Hunk[]): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: payloadFor(hunks) }]
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

async function callOpenAi(hunks: Hunk[]): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: payloadFor(hunks) }
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
      patch: hunk.lines
        .map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`)
        .join("\n")
        .slice(0, 3000)
    }))
  );
}

function parseAnnotationJson(raw: string): Array<{ id: string; summary: string; concern: string | null }> {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return annotationSchema.parse(JSON.parse(cleaned));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
