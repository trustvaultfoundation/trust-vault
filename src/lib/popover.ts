// Screen-aware placement for any portalled popover. Given the trigger's on-screen rect and the
// popover's size, returns a fixed {top,left} that:
//   • sits right next to the trigger (just below, or above when there's no room below),
//   • never runs off the right / left / bottom / top — it's clamped into the viewport with a margin.
// Used by every popup so the content is always fully visible, however close to an edge the trigger is.

export interface TriggerRect { top: number; left: number; bottom: number; right?: number }

export function placePopover(trigger: TriggerRect, width: number, height: number, gap = 6, margin = 8): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  // Horizontal: align the popover's left edge with the trigger, then pull it back in if it would
  // overflow the right edge; never push it past the left margin.
  let left = trigger.left;
  if (left + width > vw - margin) left = vw - width - margin;
  if (left < margin) left = margin;

  // Vertical: prefer below the trigger; flip above if it fits better; otherwise clamp into view.
  const below = trigger.bottom + gap;
  const roomBelow = vh - margin - below;
  const aboveTop = trigger.top - gap - height;
  let top: number;
  if (height <= roomBelow) top = below;        // fits below
  else if (aboveTop >= margin) top = aboveTop; // fits above
  else top = Math.max(margin, vh - height - margin); // not enough either way → clamp to bottom
  return { top, left };
}
