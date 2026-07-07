/**
 * Operations.jsx
 * Operational Frequency State-Machine from f2.docx:
 * Daily / Weekly / Fortnightly / Monthly checklists using operations_log table.
 * "Lock out morning shift summary if pool_water_metrics not posted by 09:00 AM."
 * "Monthly: GSTR-1 preparation data."
 */
import { useState, useRef } from "react";
import { CheckCircle, Clock, AlertTriangle, Droplets, Calendar, BarChart3, Zap, Camera } from "lucide-react";
import { useApi, apiFetch, rupee, fmtDate, todayISO, notify } from "./adminContext.js";
import { Spinner, ApiError, SectionHeader, Card, Field, Grid2, StatCard } from "./ui.jsx";

const FREQUENCIES = ["Daily", "Weekly", "Fortnightly", "Monthly"];
const FREQ_ICON = { Daily: Droplets, Weekly: Calendar, Fortnightly: Zap, Monthly: BarChart3 };

// f2.docx operational task templates
const TASK_TEMPLATES = {
  Daily: [
    { task_name:"Pool pH Test (target: 7.2–7.8)", category:"Pool",       metric_key:"pH" },
    { task_name:"Chlorine Level Check (target: 1–3 ppm)", category:"Pool", metric_key:"chlorine_ppm" },
    { task_name:"Daily KYC verification & Form C audit",  category:"Compliance" },
    { task_name:"Morning room occupancy sweep",           category:"Housekeeping" },
    { task_name:"Breakfast buffet setup & sign-off",      category:"Housekeeping" },
    { task_name:"POS cash reconciliation",                category:"Finance" },
  ],
  Weekly: [
    { task_name:"OTA TCS reconciliation & deduction log",         category:"Compliance" },
    { task_name:"Duplicate contact strip for marketing pipeline",  category:"Finance" },
    { task_name:"Linen deep-clean & replacement audit",           category:"Housekeeping" },
    { task_name:"Swimming pool shock treatment",                   category:"Pool" },
    { task_name:"Staff shift review & feedback session",          category:"HR" },
  ],
  Fortnightly: [
    { task_name:"Targeted room PM rotation (2–3 rooms)",          category:"Maintenance" },
    { task_name:"Fire safety equipment inspection",               category:"Maintenance" },
    { task_name:"AC filter cleaning — all 15 rooms",              category:"Maintenance" },
    { task_name:"Mini-bar & pantry stock recount",                category:"Finance" },
  ],
  Monthly: [
    { task_name:"GSTR-1 preparation data sheet",                  category:"Compliance" },
    { task_name:"Rule 42 ITC reversal calculation",               category:"Finance" },
    { task_name:"5% vs 18% tariff revenue split report",          category:"Finance" },
    { task_name:"Pool equipment quarterly service due check",     category:"Pool" },
    { task_name:"OTA commission reconciliation vs net revenue",   category:"Finance" },
    { task_name:"Payroll & salary processing sign-off",           category:"HR" },
  ],
};

const CATEGORY_COLOR = {
  Pool:"#06b6d4", Compliance:"#f59e0b", Housekeeping:"#10b981",
  Finance:"#a855f7", HR:"#3b82f6", Maintenance:"#f97316",
};

export default function Operations() {
  const [activeFreq, setActiveFreq] = useState("Daily");
  const [poolMetrics, setPoolMetrics] = useState({ pH:"", chlorine_ppm:"" });
  const [checkedTasks, setCheckedTasks] = useState({});
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState({});
  const [photoFiles, setPhotoFiles] = useState({});
  const fileInputRefs = useRef({});

  const tasks = TASK_TEMPLATES[activeFreq] || [];

  // Pool lock-out check: if past 09:00 and pool metrics not entered, warn
  const now = new Date();
  const isPastNine   = now.getHours() >= 9;
  const poolComplete = poolMetrics.pH && poolMetrics.chlorine_ppm;
  const poolLocked   = activeFreq === "Daily" && isPastNine && !poolComplete;

  const toggle = (key) => setCheckedTasks(p => ({ ...p, [key]: !p[key] }));

  const submitLog = async (task, metrics) => {
    const photo = photoFiles[task.task_name];
    if (!photo) { notify("A photo is required to complete this task.", "error"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("frequency",     activeFreq);
      fd.append("task_category", task.category || "General");
      fd.append("task_name",     task.task_name);
      fd.append("status",        "Completed");
      if (metrics) fd.append("metric_data", JSON.stringify(metrics));
      fd.append("photo", photo);
      await apiFetch("/api/admin/operations", { method: "POST", body: fd });
      setSubmitted(p => ({ ...p, [task.task_name]: true }));
      setPhotoFiles(p => { const n = {...p}; delete n[task.task_name]; return n; });
      notify("Task logged!", "success");
    } catch (err) {
      notify(err.message || "Failed to log task", "error");
    } finally { setBusy(false); }
  };

  const doneCount  = tasks.filter(t => submitted[t.task_name] || checkedTasks[t.task_name]).length;
  const pct        = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  return (
    <div className="ff-page">
      <SectionHeader eyebrow="Operations" title="Operational Checklists" />

      {/* Frequency tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:24, flexWrap:"wrap" }}>
        {FREQUENCIES.map(f => {
          const Icon = FREQ_ICON[f];
          return (
            <button key={f} onClick={() => setActiveFreq(f)} style={{
              display:"flex", alignItems:"center", gap:8, padding:"10px 18px",
              background: activeFreq===f ? "var(--ff-primary)" : "rgba(255,255,255,.06)",
              color: activeFreq===f ? "#fff" : "var(--ff-muted)",
              border:`1px solid ${activeFreq===f ? "var(--ff-primary)" : "var(--ff-border)"}`,
              borderRadius:10, cursor:"pointer", fontFamily:"var(--sans)", fontSize:14, fontWeight:600, transition:".18s",
            }}>
              <Icon size={16}/> {f}
            </button>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="ff-card" style={{ padding:"16px 22px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <span style={{ fontSize:14, fontWeight:600 }}>{activeFreq} checklist — {doneCount}/{tasks.length} complete</span>
          <span style={{ fontSize:22, fontFamily:"var(--serif)", color: pct===100 ? "var(--ff-success)" : "var(--ff-primary)" }}>{pct}%</span>
        </div>
        <div style={{ height:8, background:"rgba(255,255,255,.08)", borderRadius:4, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background: pct===100 ? "var(--ff-success)" : "linear-gradient(90deg,var(--ff-primary),var(--ff-accent))", borderRadius:4, transition:".5s" }}/>
        </div>
      </div>

      {/* Pool lock-out banner */}
      {poolLocked && (
        <div className="ff-alert ff-alert-warn" style={{ marginBottom:20 }}>
          <AlertTriangle size={18}/>
          <div>
            <b>Morning shift lock-out active</b>
            <p style={{ margin:"4px 0 0", fontSize:13 }}>
              Pool water metrics (pH & chlorine) have not been posted after 09:00 AM. Enter values below to unlock the daily summary.
            </p>
          </div>
        </div>
      )}

      {/* Pool metrics input (Daily only) */}
      {activeFreq === "Daily" && (
        <Card title="Pool Water Metrics" style={{ marginBottom:20 }}>
          <div className="ff-fields">
            <Grid2>
              <Field label="pH Level (target: 7.2–7.8)">
                <input type="number" step="0.1" min="0" max="14" value={poolMetrics.pH} onChange={e => setPoolMetrics(p => ({...p, pH:e.target.value}))} placeholder="7.4"/>
                {poolMetrics.pH && (
                  <p style={{ fontSize:11, marginTop:4, color: Number(poolMetrics.pH)>=7.2 && Number(poolMetrics.pH)<=7.8 ? "var(--ff-success)" : "var(--ff-danger)" }}>
                    {Number(poolMetrics.pH)>=7.2 && Number(poolMetrics.pH)<=7.8 ? "✓ Within range" : "✗ Out of range"}
                  </p>
                )}
              </Field>
              <Field label="Chlorine (ppm, target: 1.0–3.0)">
                <input type="number" step="0.1" min="0" max="10" value={poolMetrics.chlorine_ppm} onChange={e => setPoolMetrics(p => ({...p, chlorine_ppm:e.target.value}))} placeholder="2.1"/>
                {poolMetrics.chlorine_ppm && (
                  <p style={{ fontSize:11, marginTop:4, color: Number(poolMetrics.chlorine_ppm)>=1 && Number(poolMetrics.chlorine_ppm)<=3 ? "var(--ff-success)" : "var(--ff-danger)" }}>
                    {Number(poolMetrics.chlorine_ppm)>=1 && Number(poolMetrics.chlorine_ppm)<=3 ? "✓ Within range" : "✗ Out of range"}
                  </p>
                )}
              </Field>
            </Grid2>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <input
                type="file"
                accept="image/*"
                style={{ display:"none" }}
                ref={el => { fileInputRefs.current["Pool pH & Chlorine Check"] = el; }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) setPhotoFiles(p => ({ ...p, "Pool pH & Chlorine Check": file }));
                }}
              />
              <button
                className="ff-btn"
                style={{
                  padding:"7px 12px", fontSize:13,
                  background: photoFiles["Pool pH & Chlorine Check"] ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.06)",
                  border:`1px solid ${photoFiles["Pool pH & Chlorine Check"] ? "var(--ff-success)" : "var(--ff-border)"}`,
                  color: photoFiles["Pool pH & Chlorine Check"] ? "var(--ff-success)" : "var(--ff-muted)",
                  display:"flex", alignItems:"center", gap:6,
                }}
                onClick={() => fileInputRefs.current["Pool pH & Chlorine Check"]?.click()}
              >
                <Camera size={14}/> {photoFiles["Pool pH & Chlorine Check"] ? "Photo attached ✓" : "Add Photo (required)"}
              </button>
              <button className="ff-btn ff-btn-primary"
                disabled={!poolComplete || busy || !photoFiles["Pool pH & Chlorine Check"]}
                style={{ alignSelf:"flex-start", opacity: (!poolComplete || !photoFiles["Pool pH & Chlorine Check"]) ? 0.45 : 1 }}
                title={!photoFiles["Pool pH & Chlorine Check"] ? "Attach a photo first" : ""}
                onClick={() => submitLog({ task_name:"Pool pH & Chlorine Check", category:"Pool" }, { pH: Number(poolMetrics.pH), chlorine_ppm: Number(poolMetrics.chlorine_ppm) })}>
                <Droplets size={15}/> Log Pool Metrics
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Task checklist */}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {tasks.map((task, i) => {
          const done = submitted[task.task_name] || checkedTasks[task.task_name];
          const isPool = task.metric_key && activeFreq === "Daily";
          return (
            <div key={i} style={{
              background: done ? "rgba(16,185,129,.08)" : "var(--ff-card)",
              border:`1px solid ${done ? "rgba(16,185,129,.3)" : "var(--ff-border)"}`,
              borderRadius:10, padding:"14px 18px",
              display:"flex", alignItems:"center", gap:14, transition:".25s",
            }}>
              <div onClick={() => !done && toggle(task.task_name)} style={{ cursor: done ? "default" : "pointer", flexShrink:0 }}>
                {done
                  ? <CheckCircle size={22} color="var(--ff-success)"/>
                  : <div style={{ width:22, height:22, borderRadius:"50%", border:`2px solid ${checkedTasks[task.task_name] ? "var(--ff-success)" : "var(--ff-border)"}`, background: checkedTasks[task.task_name] ? "var(--ff-success)" : "transparent", transition:".18s" }}/>
                }
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600, color: done ? "var(--ff-success)" : "var(--ff-text)", textDecoration: done ? "line-through" : "none", opacity: done ? .7 : 1 }}>
                  {task.task_name}
                </div>
                <div style={{ fontSize:11, marginTop:3, display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ padding:"2px 8px", borderRadius:4, background: CATEGORY_COLOR[task.category]+"22", color: CATEGORY_COLOR[task.category], fontWeight:600 }}>{task.category}</span>
                  {!done && checkedTasks[task.task_name] && (
                    <span style={{ color:"var(--ff-muted)", fontSize:11 }}>
                      {photoFiles[task.task_name] ? `📎 ${photoFiles[task.task_name].name}` : "Photo required to log"}
                    </span>
                  )}
                </div>
              </div>
              {!done && checkedTasks[task.task_name] && (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display:"none" }}
                    ref={el => { fileInputRefs.current[task.task_name] = el; }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) setPhotoFiles(p => ({ ...p, [task.task_name]: file }));
                    }}
                  />
                  <button
                    className="ff-btn"
                    style={{
                      padding:"7px 12px", fontSize:12,
                      background: photoFiles[task.task_name] ? "rgba(16,185,129,.15)" : "rgba(255,255,255,.06)",
                      border:`1px solid ${photoFiles[task.task_name] ? "var(--ff-success)" : "var(--ff-border)"}`,
                      color: photoFiles[task.task_name] ? "var(--ff-success)" : "var(--ff-muted)",
                      display:"flex", alignItems:"center", gap:6,
                    }}
                    onClick={() => fileInputRefs.current[task.task_name]?.click()}
                  >
                    <Camera size={14}/> {photoFiles[task.task_name] ? "Change" : "Add Photo"}
                  </button>
                  <button
                    className="ff-btn ff-btn-primary"
                    style={{ padding:"7px 14px", fontSize:12, opacity: photoFiles[task.task_name] ? 1 : 0.45 }}
                    onClick={() => submitLog(task)}
                    disabled={busy || !photoFiles[task.task_name]}
                    title={!photoFiles[task.task_name] ? "Attach a photo first" : ""}
                  >
                    Log Completion
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Monthly GSTR callout */}
      {activeFreq === "Monthly" && (
        <div className="ff-alert ff-alert-info" style={{ marginTop:20 }}>
          <BarChart3 size={18}/>
          <div>
            <b>GSTR-1 Preparation Reminder</b>
            <p style={{ margin:"4px 0 0", fontSize:13 }}>
              Navigate to <b>Accounts → GST Revenue Split</b> to see the current month's 5% vs 18% revenue breakdown and estimated Rule 42 ITC reversal obligation. This data feeds directly into your CA's GSTR-1 filing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
