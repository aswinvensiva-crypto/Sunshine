import useChordShortcuts, { CHORDS } from "../hooks/useChordShortcuts.js";

function Kbd({ children }) {
  return <kbd className="ff-kbd">{children}</kbd>;
}

/**
 * Mounted once inside AdminShell — owns the single global keydown listener
 * for chord navigation, Esc, "?", and Enter-to-next-field (see
 * useChordShortcuts). Renders the chord-in-progress toast and the "?" help
 * overlay.
 */
export default function ShortcutLayer({ navigate, activeKey, escBackTo, closeOverlays }) {
  const { pendingPrefix, helpOpen, setHelpOpen } = useChordShortcuts({
    navigate, activeKey, escBackTo, closeOverlays,
  });

  return (
    <>
      {pendingPrefix && (
        <div className="ff-chord-toast" role="status" aria-live="polite">
          <Kbd>{pendingPrefix}</Kbd>
          <span>then…</span>
          {CHORDS.map((c) => (
            <span key={c.to} className="ff-chord-hint">
              <Kbd>{c.keys[1]}</Kbd> {c.label}
            </span>
          ))}
        </div>
      )}

      {helpOpen && (
        <div className="ff-shortcut-overlay" onClick={() => setHelpOpen(false)}>
          <div className="ff-shortcut-card" onClick={(e) => e.stopPropagation()}>
            <div className="ff-shortcut-head">
              <h3>Keyboard shortcuts</h3>
              <button className="ff-shortcut-close" onClick={() => setHelpOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="ff-shortcut-grid">
              {CHORDS.map((c) => (
                <div key={c.to} className="ff-shortcut-row">
                  <span className="ff-shortcut-keys">
                    <Kbd>{c.keys[0]}</Kbd><span className="ff-then">then</span><Kbd>{c.keys[1]}</Kbd>
                  </span>
                  <span>{c.label}</span>
                </div>
              ))}
              <div className="ff-shortcut-row">
                <span className="ff-shortcut-keys"><Kbd>?</Kbd></span>
                <span>Toggle this help</span>
              </div>
              <div className="ff-shortcut-row">
                <span className="ff-shortcut-keys"><Kbd>esc</Kbd></span>
                <span>Close / blur field / go back</span>
              </div>
              <div className="ff-shortcut-row">
                <span className="ff-shortcut-keys"><Kbd>enter</Kbd></span>
                <span>Next field / submit</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
