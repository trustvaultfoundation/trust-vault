"use client";

import { useEffect, useRef } from "react";
import { loadEvents, loadSharedEvents, loadMuted, expandRange, isoDate, parseISO, eventLink, meetingJoinUrl } from "./calendar";

type Toast = (m: string, t?: "error" | "info" | "warning") => void;

// Ask for OS notification permission (no-op if already decided / unsupported).
export function ensureNotifyPermission(): void {
  try { if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); } catch {}
}

function notify(title: string, body: string, link: string | undefined, onToast: Toast): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: `${title}|${body}` });
      if (link) n.onclick = () => { try { window.focus(); window.open(link, "_blank", "noopener"); } catch {} };
    }
  } catch {}
  onToast(`⏰ ${title} — ${body}`, "info");
}

// Fires reminders for upcoming (recurring or not) timed events: a few minutes before
// the start, per the event's chosen lead times. Runs while the app is open, even when
// the Calendar tab isn't, so it lives at the dashboard level.
export function useCalendarReminders(address: string | null, onToast: Toast): void {
  const fired = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!address) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (!alive) return;
      try {
        const now = Date.now();
        const d = new Date();
        const start = isoDate(d);
        const end = isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); // include tomorrow
        const myName = address.length > 10 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
        const muted = new Set(loadMuted(address));
        for (const o of expandRange([...loadEvents(address), ...loadSharedEvents(address)], start, end)) {
          if (!o.time || !o.reminders?.length || muted.has(o.seriesId)) continue;
          const [h, m] = o.time.split(":").map(Number);
          const startMs = parseISO(o.occDate).setHours(h || 0, m || 0, 0, 0);
          for (const mins of o.reminders) {
            const key = `${o.seriesId}|${o.occDate}|${mins}`;
            if (fired.current.has(key)) continue;
            const fireAt = startMs - mins * 60000;
            if (fireAt <= now && now <= fireAt + 90_000 && now < startMs + 60000) {
              fired.current.add(key);
              const when = mins === 0 ? "now" : mins >= 1440 ? `in ${Math.round(mins / 1440)} day(s)` : mins >= 60 ? `in ${Math.round(mins / 60)} hr` : `in ${mins} min`;
              const link = eventLink(o);
              notify(o.title || "Event", `${o.type === "meeting" ? "Meeting" : "Event"} starts ${when} · ${o.time}`, link ? meetingJoinUrl(link, myName) : undefined, onToast);
            }
          }
        }
      } catch {}
      t = setTimeout(tick, 30_000);
    };
    tick();
    return () => { alive = false; if (t) clearTimeout(t); };
  }, [address, onToast]);
}
