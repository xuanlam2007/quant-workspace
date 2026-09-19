"use client";

import { useEffect } from "react";

const GUARDED_INPUT_SELECTOR = "[data-clear-selection-on-outside-drag]";
const BOUNDARY_SELECTOR = "[data-selection-boundary]";

type GuardedInput = HTMLInputElement | HTMLTextAreaElement;

function isOutside(element: HTMLElement, event: PointerEvent) {
  const rect = element.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

function clearInputInteraction(input: GuardedInput) {
  input.style.userSelect = "none";
  input.blur();
  input.setSelectionRange(0, 0);
  window.getSelection()?.removeAllRanges();

  requestAnimationFrame(() => {
    input.setSelectionRange(0, 0);
    input.style.userSelect = "";
    window.getSelection()?.removeAllRanges();
  });
}

export function OutsideDragSelectionGuard() {
  useEffect(() => {
    let input: GuardedInput | null = null;
    let boundary: HTMLElement | null = null;
    let draggedOutside = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const candidate = event.target.closest<GuardedInput>(GUARDED_INPUT_SELECTOR);
      if (!candidate) return;
      input = candidate;
      boundary = candidate.closest<HTMLElement>(BOUNDARY_SELECTOR) ?? candidate;
      draggedOutside = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!input || !boundary || !isOutside(boundary, event)) return;
      event.preventDefault();
      draggedOutside = true;
      clearInputInteraction(input);
    };

    const finishInteraction = (event?: PointerEvent) => {
      if (input && boundary && (draggedOutside || (event && isOutside(boundary, event)))) {
        clearInputInteraction(input);
      }
      input = null;
      boundary = null;
      draggedOutside = false;
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, { capture: true });
    window.addEventListener("pointerup", finishInteraction, { capture: true });
    window.addEventListener("pointercancel", finishInteraction, { capture: true });

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", finishInteraction, { capture: true });
      window.removeEventListener("pointercancel", finishInteraction, { capture: true });
    };
  }, []);

  return null;
}
