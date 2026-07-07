/**
 * ui.jsx — reusable mini-components shared across every admin page.
 * Spinner, ApiError, EmptyState, Modal, Badge, ProgressBar.
 */
import { useEffect } from "react";
import { X } from "lucide-react";

export function Spinner() {
  return <div className="ff-loading">Loading…</div>;
}

export function ApiError({ msg }) {
  return (
    <div className="ff-error">
      Could not load data: {msg}
      <br />
      Make sure the backend is running on port 5001.
    </div>
  );
}

export function EmptyState({ text = "No data yet.", icon: Icon }) {
  return (
    <div className="ff-empty">
      {Icon && <Icon size={32} style={{ opacity: 0.3, marginBottom: 8 }} />}
      <p>{text}</p>
    </div>
  );
}

export function Modal({ title, onClose, children, maxWidth = 480 }) {
  /* Esc closes the modal — this is the modal's own handler that the global
     shortcut listener defers to (see useChordShortcuts' isOverlayInDom). */
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="ff-backdrop" onClick={e => { if (e.target.classList.contains("ff-backdrop")) onClose(); }}>
      <div className="ff-modal" style={{ maxWidth }}>
        <div className="ff-modal-head">
          <h3>{title}</h3>
          <button className="ff-icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="ff-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function SideDrawer({ title, onClose, children }) {
  return (
    <>
      <div className="jq-side-backdrop" onClick={onClose} />
      <div className="jq-side-panel">
        <div className="jq-side-panel-head">
          <h2 className="jq-side-panel-title">{title}</h2>
          <button className="jq-side-panel-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="jq-side-panel-body" style={{ padding: "24px" }}>
          {children}
        </div>
      </div>
    </>
  );
}

export function StatusBadge({ value, map }) {
  const cls = map?.[value] || "ff-badge-muted";
  return <span className={`ff-badge ${cls}`}>{String(value).replace(/_/g, " ")}</span>;
}

export function ProgressBar({ pct, color = "var(--ff-primary)" }) {
  return (
    <div className="ff-progress">
      <div className="ff-progress-bar" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

export function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="ff-page-header">
      <div>
        <p className="ff-eyebrow">{eyebrow}</p>
        <h2 className="ff-page-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, iconBg, valueColor = "" }) {
  return (
    <div className="ff-card ff-stat-card">
      <div className="ff-stat-header">
        <span className="ff-stat-label">{label}</span>
        {Icon && <div className={`ff-stat-icon ${iconBg || "ff-icon-bg-primary"}`}><Icon size={20} /></div>}
      </div>
      <div className={`ff-stat-value ${valueColor}`}>{value}</div>
      {sub && <div className="ff-muted-sm" style={{ marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export function Card({ title, children, noPad = false, action, style }) {
  return (
    <div className="ff-card" style={{ ...(noPad ? { padding: 0 } : {}), ...style }}>
      {title && (
        <div className="ff-card-header ff-card-header-border" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 className="ff-card-title">{title}</h3>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="ff-card-body">{children}</div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div className="ff-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Grid2({ children }) {
  return <div className="ff-grid-2">{children}</div>;
}

export function TableWrap({ children, sticky = false }) {
  return (
    <div className={`ff-table-wrap ${sticky ? "ff-sticky-head" : ""}`}>
      <table className="ff-table">{children}</table>
    </div>
  );
}
