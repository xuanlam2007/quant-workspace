"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_TOOLTIP_DELAY_MS = 500;
const TOOLTIP_SESSION_GRACE_MS = 250;
const TOOLTIP_ID = "delayed-global-tooltip";
const TOOLTIP_SELECTOR =
  "[data-tooltip], button[aria-label], summary[aria-label], [role='button'][aria-label]";

type TooltipPlacement = "top" | "right" | "bottom" | "left";

interface TooltipContent {
  text: string;
  hotkey?: string;
  description?: string;
}

interface TooltipState extends TooltipContent {
  placement: TooltipPlacement;
  x: number;
  y: number;
}

function findTooltipTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(TOOLTIP_SELECTOR);
  if (!element || element.dataset.tooltipDisabled === "true") return null;
  return element;
}

function readTooltipContent(element: HTMLElement): TooltipContent | null {
  const text = element.dataset.tooltip ?? element.getAttribute("aria-label") ?? "";
  const normalizedText = text.trim();
  if (!normalizedText) return null;

  return {
    text: normalizedText,
    hotkey: element.dataset.tooltipHotkey,
    description: element.dataset.tooltipDescription,
  };
}

function readPlacement(element: HTMLElement): TooltipPlacement {
  const placement = element.dataset.tooltipPlacement;
  if (placement === "top" || placement === "right" || placement === "left") {
    return placement;
  }
  return "bottom";
}

function readDelay(element: HTMLElement): number {
  const configuredDelay = Number.parseInt(element.dataset.tooltipDelay ?? "", 10);
  return Number.isFinite(configuredDelay) && configuredDelay >= 0
    ? configuredDelay
    : DEFAULT_TOOLTIP_DELAY_MS;
}

function positionTooltip(element: HTMLElement, content: TooltipContent): TooltipState {
  const rect = element.getBoundingClientRect();
  const placement = readPlacement(element);

  if (placement === "right") {
    return { ...content, placement, x: rect.right + 8, y: rect.top + rect.height / 2 };
  }
  if (placement === "left") {
    return { ...content, placement, x: rect.left - 8, y: rect.top + rect.height / 2 };
  }
  if (placement === "top") {
    return { ...content, placement, x: rect.left + rect.width / 2, y: rect.top - 7 };
  }
  return { ...content, placement, x: rect.left + rect.width / 2, y: rect.bottom + 7 };
}

export function DelayedTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmRef = useRef(false);
  const pointerDownRef = useRef(false);
  const describedByRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }, []);

  const removeDescription = useCallback(() => {
    const target = activeTargetRef.current;
    if (!target) return;

    if (describedByRef.current) {
      target.setAttribute("aria-describedby", describedByRef.current);
    } else {
      target.removeAttribute("aria-describedby");
    }
    describedByRef.current = null;
  }, []);

  const hide = useCallback(
    (resetSession = true) => {
      clearTimer();
      clearSessionTimer();
      removeDescription();
      activeTargetRef.current = null;
      if (resetSession) warmRef.current = false;
      setTooltip(null);
    },
    [clearSessionTimer, clearTimer, removeDescription],
  );

  const hideWithGrace = useCallback(() => {
    hide(false);
    sessionTimerRef.current = setTimeout(() => {
      sessionTimerRef.current = null;
      warmRef.current = false;
    }, TOOLTIP_SESSION_GRACE_MS);
  }, [hide]);

  const show = useCallback((element: HTMLElement, content: TooltipContent) => {
    describedByRef.current = element.getAttribute("aria-describedby");
    const describedBy = describedByRef.current
      ? `${describedByRef.current} ${TOOLTIP_ID}`
      : TOOLTIP_ID;
    element.setAttribute("aria-describedby", describedBy);
    warmRef.current = true;
    setTooltip(positionTooltip(element, content));
  }, []);

  const activate = useCallback(
    (element: HTMLElement) => {
      const content = readTooltipContent(element);
      if (!content) {
        hide();
        return;
      }

      clearTimer();
      clearSessionTimer();
      removeDescription();
      activeTargetRef.current = element;
      setTooltip(null);

      if (warmRef.current) {
        show(element, content);
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (activeTargetRef.current === element && element.isConnected) {
          show(element, content);
        }
      }, readDelay(element));
    },
    [clearSessionTimer, clearTimer, hide, removeDescription, show],
  );

  useEffect(() => {
    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = findTooltipTarget(event.target);
      if (!target || target === activeTargetRef.current) return;
      activate(target);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || pointerDownRef.current || activeTargetRef.current) return;
      const target = findTooltipTarget(event.target);
      if (target) activate(target);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget || !activeTarget.contains(event.target as Node)) return;

      const nextTarget = findTooltipTarget(event.relatedTarget);
      if (nextTarget && nextTarget !== activeTarget) {
        activate(nextTarget);
      } else if (!nextTarget) {
        hideWithGrace();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (pointerDownRef.current) return;
      const target = findTooltipTarget(event.target);
      if (target?.matches(":focus-visible")) activate(target);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (activeTargetRef.current?.contains(event.target as Node)) hide();
    };

    const handlePointerDown = () => {
      pointerDownRef.current = true;
      hide();
    };
    const handlePointerUp = () => {
      pointerDownRef.current = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") hide();
    };
    const handleViewportChange = () => hide();

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerUp, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);

    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("pointercancel", handlePointerUp, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
      clearTimer();
      clearSessionTimer();
      removeDescription();
      activeTargetRef.current = null;
    };
  }, [activate, clearSessionTimer, clearTimer, hide, hideWithGrace, removeDescription]);

  if (!tooltip) return null;

  return (
    <div
      id={TOOLTIP_ID}
      className={`delayed-tooltip delayed-tooltip--${tooltip.placement}`}
      style={{ left: tooltip.x, top: tooltip.y }}
      role="tooltip"
    >
      <span className="delayed-tooltip__arrow" />
      <span className="delayed-tooltip__body">
        <strong>{tooltip.text}</strong>
        {tooltip.hotkey && (
          <>
            <span className="delayed-tooltip__divider" />
            <kbd>{tooltip.hotkey}</kbd>
          </>
        )}
        {tooltip.description && (
          <span className="delayed-tooltip__description">- {tooltip.description}</span>
        )}
      </span>
    </div>
  );
}
