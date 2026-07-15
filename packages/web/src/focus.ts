import type { RefObject } from "react";

type FocusTarget = HTMLElement | null | undefined;

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLInputElement === "undefined") {
    return false;
  }
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function focusElement(target: FocusTarget): void {
  target?.focus();
}

export function focusDiffPane(ref: RefObject<HTMLElement>): void {
  focusElement(ref.current);
}

export function focusNote(ref: RefObject<HTMLTextAreaElement>): void {
  focusElement(ref.current);
}

export function captureFocus(): HTMLElement | null {
  return typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function restoreFocus(target: FocusTarget): void {
  focusElement(target);
}

export function focusFirst(container: FocusTarget): void {
  if (!container) {
    return;
  }
  focusElement(
    container.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )
  );
}

export function trapFocus(event: KeyboardEvent, container: FocusTarget): void {
  if (event.key !== "Tab" || !container) {
    return;
  }
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  ));
  if (focusable.length === 0) {
    event.preventDefault();
    focusElement(container);
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    focusElement(last);
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focusElement(first);
  }
}
