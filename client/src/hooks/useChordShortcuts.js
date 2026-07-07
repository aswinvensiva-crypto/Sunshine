/**
 * useChordShortcuts.js — Gmail/Linear-style "n then <key>" navigation chords,
 * global Esc (close overlay / blur field / go up a level), "?" help overlay,
 * and Enter-to-next-field for fast data entry.
 *
 * Sunshine's admin panel has no URL router — pages are switched via local
 * `active` state in AdminShell (see AdminApp.jsx). So instead of
 * react-router's useNavigate(), this hook is handed the app's own
 * `navigate(key)` closure and drives it the same way.
 *
 * This is the ONE global keydown listener for the admin shell (chords, Esc,
 * "?", Enter) — see ShortcutLayer.jsx, mounted once in AdminShell.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { parentOf } from "../utils/nav.js";

/* Chord map: prefix 'n' = navigate. `to` values are AdminShell page keys. */
export const CHORDS = [
  { keys: ["n", "d"], label: "Dashboard",             to: "dashboard" },
  { keys: ["n", "f"], label: "Front Desk",             to: "frontdesk" },
  { keys: ["n", "p"], label: "Availability & Rates",   to: "pricing" },
  { keys: ["n", "a"], label: "Accounts",               to: "accounts" },
  { keys: ["n", "s"], label: "Staff",                  to: "staff" },
  { keys: ["n", "t"], label: "Tasks",                  to: "tasks" },
  { keys: ["n", "r"], label: "Routines",               to: "routines" },
  { keys: ["n", "o"], label: "Operations",             to: "operations" },
];

const CHORD_TIMEOUT_MS = 1500;

const isTypingTarget = (el) =>
  !!el && (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );

/* Page-level overlays this hook doesn't own directly: shared <Modal>,
   <SideDrawer>, and AdminShell's grid/user dropdown panels. */
const isOverlayInDom = () =>
  !!document.querySelector(".ff-backdrop, .jq-side-backdrop, .jq-menu-overlay");

function focusableFieldsIn(container) {
  return Array.from(
    container.querySelectorAll("input:not([type=hidden]):not([disabled]), select:not([disabled])")
  ).filter((el) => el.offsetParent !== null);
}

function topmostModalOrMain() {
  const backdrops = document.querySelectorAll(".ff-backdrop");
  if (backdrops.length) return backdrops[backdrops.length - 1];
  return document.querySelector("main.jq-main") || document.body;
}

/**
 * @param {() => void} navigate - change the active admin page, e.g. navigate('dashboard')
 * @param {string} activeKey - current active page key
 * @param {string} [escBackTo] - optional drill-down override for Esc's "go up" target
 * @param {() => boolean} [closeOverlays] - close any shell-owned dropdown/menu; return true if one was open
 */
export default function useChordShortcuts({ navigate, activeKey, escBackTo, closeOverlays }) {
  const [pendingPrefix, setPendingPrefix] = useState(null); // 'n' | null
  const [helpOpen, setHelpOpen] = useState(false);
  const timerRef = useRef(null);

  /* Latest callbacks/values in a ref so the listener never reads stale props
     without needing to re-subscribe on every parent render. */
  const propsRef = useRef();
  propsRef.current = { navigate, activeKey, escBackTo, closeOverlays };

  const clearPending = useCallback(() => {
    clearTimeout(timerRef.current);
    setPendingPrefix(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const { navigate, activeKey, escBackTo, closeOverlays } = propsRef.current;
      const target = e.target;

      /* Number-input safety: ArrowUp/Down must not bump the value while
         chords/typing rules are being evaluated below. */
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") &&
          target.tagName === "INPUT" && target.type === "number") {
        e.preventDefault();
        return;
      }

      const typing = isTypingTarget(target) || isTypingTarget(document.activeElement);

      /* ── Escape: help overlay → shell dropdowns → page modal → blur → go up ── */
      if (e.key === "Escape") {
        if (helpOpen) { e.preventDefault(); setHelpOpen(false); clearPending(); return; }
        if (closeOverlays && closeOverlays()) { clearPending(); return; }
        if (isOverlayInDom()) { clearPending(); return; } // let the modal's own close handle it
        if (typing) { document.activeElement.blur(); clearPending(); return; }
        clearPending();
        const parent = parentOf(activeKey, escBackTo);
        if (parent) navigate(parent);
        return;
      }

      /* ── Enter: next field, or click the primary submit on the last field ── */
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented) {
        const tag = target.tagName;
        if ((tag === "INPUT" || tag === "SELECT") && !target.isContentEditable) {
          e.preventDefault();
          const container = topmostModalOrMain();
          const fields = focusableFieldsIn(container);
          const idx = fields.indexOf(target);
          if (idx === -1) return;
          if (idx < fields.length - 1) {
            const next = fields[idx + 1];
            next.focus();
            if (typeof next.select === "function") next.select();
          } else {
            const submitBtn = container.querySelector("[data-ff-submit]:not(:disabled)");
            if (submitBtn) submitBtn.click();
          }
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing) return; // never hijack typing for chords/"?"

      /* "?" toggles the help overlay */
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        clearPending();
        return;
      }

      if (isOverlayInDom()) return; // chords don't navigate while a modal/dropdown is open

      const key = e.key.toLowerCase();

      /* Second key of a chord */
      if (pendingPrefix === "n") {
        const chord = CHORDS.find((c) => c.keys[1] === key);
        clearPending();
        if (chord) {
          e.preventDefault();
          setHelpOpen(false);
          navigate(chord.to);
        }
        return;
      }

      /* Chord prefix */
      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        setPendingPrefix("n");
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setPendingPrefix(null), CHORD_TIMEOUT_MS);
      }
    };

    const onWheel = () => {
      const el = document.activeElement;
      if (el && el.tagName === "INPUT" && el.type === "number") el.blur();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("wheel", onWheel);
      clearTimeout(timerRef.current);
    };
  }, [pendingPrefix, helpOpen, clearPending]);

  return { pendingPrefix, helpOpen, setHelpOpen };
}
