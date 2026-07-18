import { trailFor, parentOf } from "../utils/nav.js";

/**
 * Sticky sub-header showing the page trail, a "← Back to {parent}" chip, and
 * the Esc affordance for the go-up-a-level shortcut (see useChordShortcuts).
 * Hidden entirely on the Dashboard (the root page).
 */
export default function Breadcrumbs({ activeKey, escBackTo, onNavigate }) {
  if (!activeKey || activeKey === "dashboard") return null;

  const trail = trailFor(activeKey, escBackTo);
  const parent = parentOf(activeKey, escBackTo);
  if (trail.length === 0) return null;

  return (
    <div className="ff-breadcrumbs">
      <button
        className="ff-breadcrumb-back"
        onClick={() => parent && onNavigate(parent)}
        disabled={!parent}
      >
        ← Back to {trail[trail.length - 2]?.label || "Dashboard"}
      </button>

      <nav className="ff-breadcrumb-trail" aria-label="Breadcrumb">
        {trail.map((step, i) => (
          <span key={step.key} className="ff-breadcrumb-step">
            {i > 0 && <span className="ff-breadcrumb-sep">/</span>}
            {i === trail.length - 1
              ? <span className="ff-breadcrumb-current">{step.label}</span>
              : <button className="ff-breadcrumb-link" onClick={() => onNavigate(step.key)}>{step.label}</button>}
          </span>
        ))}
      </nav>

      <kbd className="ff-kbd ff-breadcrumb-esc" title="Press Esc to go back">esc</kbd>
    </div>
  );
}
