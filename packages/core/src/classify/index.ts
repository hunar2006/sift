import type { Hunk, ParsedHunk, ProvenanceRef } from "../types.js";
import { classifyHunk } from "./categories.js";
import { computeRiskSignals, type SignalContext } from "./signals.js";
import { scoreHunk } from "../score.js";
import { applyRulesToReasons, type EffectiveRules } from "../rules.js";

export interface Classifier {
  classify(hunk: ParsedHunk, generatedPaths?: Set<string>, provenance?: ProvenanceRef, context?: ClassifierContext): Hunk;
}

export interface ClassifierContext extends SignalContext {
  rules?: EffectiveRules;
}

export class HeuristicClassifier implements Classifier {
  classify(
    hunk: ParsedHunk,
    generatedPaths: Set<string> = new Set(),
    provenance?: ProvenanceRef,
    context: ClassifierContext = {}
  ): Hunk {
    const initial = classifyHunk(hunk, [], generatedPaths);
    const initialReasons = applyRulesToReasons(
      hunk,
      computeRiskSignals(hunk, initial.category, context),
      context.rules
    );
    const classification = classifyHunk(hunk, initialReasons, generatedPaths);
    const reasons =
      classification.category === initial.category
        ? initialReasons
        : applyRulesToReasons(
            hunk,
            computeRiskSignals(hunk, classification.category, context),
            context.rules
          );
    const scored = scoreHunk(classification.category, reasons);
    return {
      id: hunk.id ?? "",
      file: hunk.file,
      oldPath: hunk.oldPath,
      language: hunk.language,
      header: hunk.header,
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines: hunk.lines,
      addedLines: hunk.addedLines,
      removedLines: hunk.removedLines,
      category: classification.category,
      categoryReason: classification.reason,
      risk: scored.risk,
      band: scored.band,
      reasons,
      coverage: hunk.coverage,
      defines: hunk.defines,
      references: hunk.references,
      groupId: "",
      provenance
    };
  }
}
