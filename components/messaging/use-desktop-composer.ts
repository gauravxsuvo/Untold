"use client";
import { useEffect, type RefObject } from "react";

// Redirect normal desktop typing without synthesizing key events or changing
// keyboard shortcuts. The original key continues into the newly focused input.
export function useDesktopComposer(
  composer: RefObject<HTMLTextAreaElement | null>,
  enabled: boolean,
  conversationId: string | null,
) {
  useEffect(() => {
    if (!enabled || !conversationId) return;
    function typing(event: KeyboardEvent) {
      if (
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        event.key === "Dead" ||
        event.key === "Process" ||
        (event.key.length !== 1 && event.key !== "Backspace")
      )
        return;
      const selectedRow = target?.closest("button.conversation-row[aria-pressed='true']");
      if (
        document.querySelector("dialog[open], [aria-modal='true']") ||
        (!selectedRow &&
          target?.closest(
            "input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='slider'], [data-no-chat-typing]",
          ))
      )
        return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const input = composer.current;
      if (!input || input.disabled || input.readOnly || input.getClientRects().length === 0) return;
      if (event.key === "Backspace" && !input.value) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
    document.addEventListener("keydown", typing, true);
    return () => document.removeEventListener("keydown", typing, true);
  }, [composer, enabled, conversationId]);
}
