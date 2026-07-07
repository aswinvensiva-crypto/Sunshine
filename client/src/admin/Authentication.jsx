import { useState, useEffect } from "react";
import { Bell, Mail, FileText, MessageCircle, CheckCircle, XCircle, AlertTriangle, RefreshCw, Trash2, Search, Wifi, WifiOff, Clock } from "lucide-react";
import { useApi, apiFetch, fmtDate, fmtTime, getUser, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, TableWrap, EmptyState } from "./ui.jsx";

const TYPE_ICON  = { email: Mail, invoice: FileText, whatsapp: MessageCircle };
const TYPE_COLOR = { email: "#3b82f6", invoice: "#a855f7", whatsapp: "#25d366" };

const STATUS_BADGE = {
  sent:    { cls: "ff-badge-green", icon: CheckCircle,    label: "Sent"    },
  failed:  { cls: "ff-badge-red",   icon: XCircle,        label: "Failed"  },
  skipped: { cls: "ff-badge-muted", icon: AlertTriangle,  label: "Skipped" },
};

export default function Authentication({ isStaff = false }) {
  const logs = useApi(() => apiFetch("/api/admin/notifications"));
  const [clearing, setClearing] = useState(false);
  const [emailSearch, setEmailSearch] = useState("");
  const [waStatus, setWaStatus] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const isOwner = !isStaff && getUser()?.role === "owner";

  // Poll WhatsApp status every 15 seconds
  useEffect(() => {
    let mounted = true;
    const fetchStatus = () =>
      apiFetch("/api/admin/whatsapp/status")
        .then(s => { if (mounted) setWaStatus(s); })
        .catch(() => {});
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const r = await apiFetch("/api/admin/whatsapp/retry", { method: "POST" });
      notify(`Retry complete — ${r.remaining} message(s) still pending`, r.remaining === 0 ? "success" : "info");
      setWaStatus(prev => prev ? { ...prev, pending_count: r.remaining } : prev);
      logs.reload();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setRetrying(false);
    }
  };

  const data = (logs.data || []).filter(l =>
    !emailSearch.trim() ||
    (l.email || "").toLowerCase().includes(emailSearch.trim().toLowerCase())
  );

  const counts = {
    total:   data.length,
    sent:    data.filter(l => l.status === "sent").length,
    failed:  data.filter(l => l.status === "failed").length,
    skipped: data.filter(l => l.status === "skipped").length,
  };

  if (logs.loading) return <Spinner />;
  if (logs.error)   return <ApiError msg={logs.error} />;

  return (
    <div className="ff-page">
      <SectionHeader
        eyebrow="System"
        title="Notification Log"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ff-btn ff-btn-ghost" onClick={logs.reload}>
              <RefreshCw size={14} /> Refresh
            </button>
            {isOwner && (
              <button
                className="ff-btn ff-btn-danger"
                disabled={clearing || data.length === 0}
                onClick={async () => {
                  if (!window.confirm("Clear all notification logs? This cannot be undone.")) return;
                  setClearing(true);
                  try {
                    await apiFetch("/api/admin/notifications", { method: "DELETE" });
                    notify("Logs cleared", "success");
                    logs.reload();
                  } catch (e) {
                    notify(e.message, "error");
                  } finally { setClearing(false); }
                }}
              >
                <Trash2 size={14} /> {clearing ? "Clearing…" : "Clear Logs"}
              </button>
            )}
          </div>
        }
      />

      {/* Email search */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, maxWidth: 340 }}>
        <Search size={15} style={{ color: "var(--ff-muted)", flexShrink: 0 }} />
        <input
          value={emailSearch}
          onChange={e => setEmailSearch(e.target.value)}
          placeholder="Search by guest email…"
          style={{
            flex: 1, background: "var(--ff-surface)", color: "var(--ff-text)",
            border: "1px solid var(--ff-border)", borderRadius: 6,
            padding: "7px 12px", fontSize: 13,
          }}
        />
        {emailSearch && (
          <button className="ff-btn ff-btn-ghost" style={{ padding: "4px 8px" }} onClick={() => setEmailSearch("")}>
            <XCircle size={14} />
          </button>
        )}
      </div>

      {/* Summary chips */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          { label: `All (${counts.total})`,         color: "var(--ff-primary)",  bg: "rgba(255,255,255,.06)" },
          { label: `Sent (${counts.sent})`,          color: "var(--ff-success)",  bg: "rgba(34,197,94,.1)"    },
          { label: `Failed (${counts.failed})`,      color: "var(--ff-danger)",   bg: "rgba(239,68,68,.1)"    },
          { label: `Skipped (${counts.skipped})`,    color: "var(--ff-muted)",    bg: "rgba(255,255,255,.04)" },
        ].map(c => (
          <div key={c.label} style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}44`, padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
            {c.label}
          </div>
        ))}
      </div>

      {/* Config reminder if credentials not set */}
      <Card title="Setup Checklist">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SetupRow icon={Mail} label="Gmail SMTP" envKey="GMAIL_USER / GMAIL_PASS"
            hint="Create a Gmail App Password at myaccount.google.com → Security → 2-Step → App passwords" />
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--ff-border)" }}>
            <MessageCircle size={16} style={{ color: "var(--ff-primary)", marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>WhatsApp Web</span>
                {waStatus == null ? null : waStatus.ready ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(34,197,94,.12)", color: "#22c55e", border: "1px solid #22c55e55", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
                    <Wifi size={11} /> Connected
                  </span>
                ) : waStatus.initializing ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(234,179,8,.12)", color: "#eab308", border: "1px solid #eab30855", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
                    <Clock size={11} /> Initializing…
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(239,68,68,.12)", color: "#ef4444", border: "1px solid #ef444455", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
                    <WifiOff size={11} /> Not connected
                  </span>
                )}
                {waStatus?.pending_count > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(239,68,68,.1)", color: "#ef4444", border: "1px solid #ef444444", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
                    {waStatus.pending_count} queued
                  </span>
                )}
                {waStatus?.ready && waStatus?.pending_count > 0 && (
                  <button className="ff-btn ff-btn-ghost" style={{ padding: "2px 10px", fontSize: 12 }} disabled={retrying} onClick={handleRetry}>
                    <RefreshCw size={11} /> {retrying ? "Retrying…" : "Retry now"}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--ff-muted)", fontFamily: "monospace", marginTop: 2 }}>Auto (QR scan on first boot)</div>
              <div style={{ fontSize: 12, color: "var(--ff-muted)", marginTop: 4, fontStyle: "italic" }}>
                {waStatus && !waStatus.ready && !waStatus.initializing
                  ? "⚠ Scan the QR code in the server console to connect. Failed messages are queued and will send automatically once connected."
                  : "Scan the QR code printed in the server console on first start. Session is saved — only needed once. Set OWNER_PHONE in .env to override the default owner number."}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Log table */}
      <div className="ff-card" style={{ padding: 0, marginTop: 20 }}>
        {data.length === 0 ? (
          <EmptyState icon={Bell} text="No notifications sent yet. Create a booking to trigger an email confirmation." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Booking Ref</th>
                <th>Guest</th>
                <th>Channel</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Message / Error</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              {data.map(l => {
                const badge  = STATUS_BADGE[l.status] || STATUS_BADGE.skipped;
                const Icon   = TYPE_ICON[l.type] || Bell;
                const color  = TYPE_COLOR[l.type] || "var(--ff-muted)";
                const BadgeIcon = badge.icon;
                return (
                  <tr key={l.id} style={{ verticalAlign: "top" }}>
                    <td className="ff-mono" style={{ fontWeight: 600 }}>{l.booking_ref}</td>
                    <td>{l.guest_name || "—"}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, color }}>
                        <Icon size={14} />
                        <span style={{ textTransform: "capitalize", fontSize: 13, fontWeight: 600 }}>{l.type}</span>
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ff-muted)" }}>{l.email || l.phone || "—"}</td>
                    <td>
                      <span className={`ff-badge ${badge.cls}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <BadgeIcon size={11} /> {badge.label}
                      </span>
                    </td>
                    <td style={{ width: 220, wordBreak: "break-word" }}>
                      {l.status === "failed" || l.status === "skipped"
                        ? <span style={{ color: "var(--ff-danger)", fontSize: 12 }}>{l.error || "—"}</span>
                        : <span style={{ color: "var(--ff-success)", fontSize: 12 }}>{l.message || "—"}</span>}
                    </td>
                    <td style={{ minWidth: 130, whiteSpace: "nowrap", fontSize: 12, color: "var(--ff-muted)" }}>
                      <div>{fmtDate(l.sent_at)}</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>{fmtTime(l.sent_at)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </div>
    </div>
  );
}

function SetupRow({ icon: Icon, label, envKey, hint }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--ff-border)" }}>
      <Icon size={16} style={{ color: "var(--ff-primary)", marginTop: 2, flexShrink: 0 }} />
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--ff-muted)", fontFamily: "monospace", marginTop: 2 }}>{envKey}</div>
        <div style={{ fontSize: 12, color: "var(--ff-muted)", marginTop: 4, fontStyle: "italic" }}>{hint}</div>
      </div>
    </div>
  );
}
