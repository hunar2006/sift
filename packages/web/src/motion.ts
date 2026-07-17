import type { Transition } from "motion/react";

/** Shared instrument motion: one vocabulary, never decorative animation. */
export const SPRING = {
  snap: { type: "spring", stiffness: 600, damping: 34 },
  settle: { type: "spring", stiffness: 380, damping: 30 },
  glide: { type: "spring", stiffness: 260, damping: 32 }
} as const satisfies Record<string, Transition>;

export function motionTransition(reduced: boolean | null, transition: Transition): Transition {
  return reduced ? { duration: 0 } : transition;
}
