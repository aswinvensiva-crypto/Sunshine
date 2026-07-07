import './admin.css';
import { useState, useEffect } from "react";
import {
  Menu, ChevronDown, PenLine, History,
  Moon, Sun, LayoutGrid, LogOut, ChevronRight, X, ListChecks, LayoutDashboard,
  ConciergeBell, ClipboardList, CheckSquare, Camera, Bell, Star,
} from "lucide-react";
import { employeeLogin, setEmployeeSession, getEmployeeUser, getEmployeeToken, clearEmployeeSession, initToaster } from "./adminContext.js";
import LoginPage from "./LoginPage.jsx";

import Dashboard       from "./Dashboard.jsx";
import FrontDesk       from "./FrontDesk.jsx";
import Bookings        from "./Bookings.jsx";
import Tasks           from "./Tasks.jsx";
import Routines        from "./Routines.jsx";
import Operations      from "./Operations.jsx";
import Authentication  from "./Authentication.jsx";
import SpecialRequests from "./SpecialRequests.jsx";
import MyTasks         from "./MyTasks.jsx";

/* All staff nav items */
const ALL_STAFF_NAV = [
  { key:"dashboard",       label:"Dashboard",        sub:"Live overview",         icon:LayoutDashboard, color:"jq-ic-pink"   },
  { key:"frontdesk",       label:"Front Desk",       sub:"Check-In wizard",       icon:ConciergeBell,   color:"jq-ic-green"  },
  { key:"bookings",        label:"Bookings",          sub:"All reservations",      icon:ClipboardList,   color:"jq-ic-purple" },
  { key:"tasks",           label:"Tasks",             sub:"Ad-hoc tasks",          icon:CheckSquare,     color:"jq-ic-blue"   },
  { key:"mytasks",         label:"My Tasks",          sub:"Assigned to me",        icon:CheckSquare,     color:"jq-ic-green"  },
  { key:"routines",        label:"Routines",          sub:"Photo verification",    icon:Camera,          color:"jq-ic-orange" },
  { key:"operations",      label:"Operations",        sub:"Daily checklists",      icon:ClipboardList,   color:"jq-ic-teal"   },
  { key:"authentication",  label:"Notifications",     sub:"Email & WhatsApp log",  icon:Bell,            color:"jq-ic-indigo" },
  { key:"specialrequests", label:"Special Requests",  sub:"Guest requests",        icon:Star,            color:"jq-ic-yellow" },
];

/* Which keys get a quick-strip button */
const QUICK_TAB_KEYS = ["frontdesk", "tasks", "mytasks", "routines", "operations"];

const ROLE_NAV = {
  "Front Desk":     ["dashboard", "frontdesk", "bookings", "tasks", "routines", "operations", "authentication", "specialrequests"],
  "Pool Attendant": ["dashboard", "tasks", "routines", "operations"],
  "Maintenance":    ["dashboard", "tasks", "routines", "operations"],
  "Housekeeping":   ["dashboard", "mytasks", "routines", "operations"],
};

function getVisibleNav(roles) {
  const roleList = Array.isArray(roles) ? roles : [roles];
  const allowed = new Set();
  roleList.forEach(r => {
    const keys = ROLE_NAV[r];
    if (keys) keys.forEach(k => allowed.add(k));
    else { allowed.add("tasks"); allowed.add("routines"); }
  });
  return ALL_STAFF_NAV.filter(n => allowed.has(n.key));
}

function getDefaultPage() {
  return "dashboard";
}

/* ── Toast renderer ── */
function Toaster({ toasts }) {
  return (
    <div className="ff-toaster">
      {toasts.map(t => (
        <div key={t.id} className={`ff-toast ff-toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}

/* ── Front Desk slide-in panel ── */
function FrontDeskPanel({ onClose, onNavigate }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div className="jq-side-backdrop" onClick={onClose} />
      <div className="jq-side-panel">
        <div className="jq-side-panel-head">
          <h2 className="jq-side-panel-title">Front Desk — Check In</h2>
          <button className="jq-side-panel-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="jq-side-panel-body">
          <FrontDesk onNavigate={onNavigate} />
        </div>
      </div>
    </>
  );
}

export default function StaffApp() {
  const [authed, setAuthed] = useState(!!getEmployeeToken());
  const [toasts, setToasts] = useState([]);
  initToaster(setToasts);

  return (
    <>
      {authed
        ? <StaffShell onLogout={() => { clearEmployeeSession(); window.location.href = '/'; }} />
        : <LoginPage
            subtitle="Staff Portal — Sunshine Resort"
            hint="Use your staff credentials to sign in."
            isStaff
            onLogin={async (u, p) => { const { token, employee } = await employeeLogin(u, p); setEmployeeSession(token, employee); setAuthed(true); }}
          />
      }
      <Toaster toasts={toasts} />
    </>
  );
}

function StaffShell({ onLogout }) {
  const user        = getEmployeeUser();
  const userRoles   = user.roles || [user.role || "Front Desk"];
  const visibleNav  = getVisibleNav(userRoles);
  const defaultPage = getDefaultPage();

  const [active,   setActive]   = useState(defaultPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [fdPanel,  setFdPanel]  = useState(false);

  const navigate = (key) => {
    const allowed = visibleNav.map(n => n.key);
    setActive(allowed.includes(key) ? key : defaultPage);
    setMenuOpen(false);
    setUserOpen(false);
    setFdPanel(false);
  };

  /* Close on outside click */
  useEffect(() => {
    if (!menuOpen && !userOpen) return;
    const handler = (e) => {
      if (!e.target.closest(".jq-menu-panel") &&
          !e.target.closest(".jq-user-panel") &&
          !e.target.closest("[data-jq-toggle]")) {
        setMenuOpen(false); setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, userOpen]);

  /* Quick tabs: only those allowed for this role */
  const quickTabs = visibleNav.filter(n => QUICK_TAB_KEYS.includes(n.key));

  /* Whether Front Desk is accessible for pen icon */
  const canFrontDesk = visibleNav.some(n => n.key === "frontdesk");
  const canBookings  = visibleNav.some(n => n.key === "bookings");

  const Page = () => {
    const props = { onNavigate: navigate };
    switch (active) {
      case "dashboard":        return <Dashboard       {...props} />;
      case "frontdesk":        return <FrontDesk       {...props} />;
      case "bookings":         return <Bookings        {...props} isStaff />;
      case "tasks":            return <Tasks           {...props} isStaff />;
      case "routines":         return <Routines        {...props} isStaff />;
      case "operations":       return <Operations      {...props} />;
      case "authentication":   return <Authentication  {...props} isStaff />;
      case "specialrequests":  return <SpecialRequests {...props} isStaff />;
      case "mytasks":          return <MyTasks         {...props} />;
      default:                 return <Dashboard       {...props} />;
    }
  };

  return (
    <div className="jq-shell" data-theme={darkMode ? "dark" : "light"}>
      {/* ── Top Bar ── */}
      <header className="jq-topbar">
        <div className="jq-topbar-left" />

        <div className="jq-topbar-center">
          <span className="jq-logo">Sunshine</span>
        </div>

        <div className="jq-topbar-right">
          {/* Dashboard (always visible) */}
          <button
            className={`jq-icon-btn ${active === "dashboard" ? "active" : ""}`}
            title="Dashboard"
            onClick={() => navigate("dashboard")}
          >
            <LayoutDashboard size={18} />
          </button>

          {/* Front Desk slide panel (only if role allows) */}
          {canFrontDesk && (
            <button
              className="jq-icon-btn"
              title="Front Desk"
              onClick={() => { setFdPanel(true); setMenuOpen(false); setUserOpen(false); }}
            >
              <PenLine size={18} />
            </button>
          )}

          {/* Bookings shortcut (only if role allows) */}
          {canBookings && (
            <button
              className={`jq-icon-btn ${active === "bookings" ? "active" : ""}`}
              title="Bookings"
              onClick={() => navigate("bookings")}
            >
              <History size={18} />
            </button>
          )}

          {/* Tasks (if role allows) */}
          {visibleNav.some(n => n.key === "tasks") && (
            <button
              className={`jq-icon-btn ${active === "tasks" ? "active" : ""}`}
              title="Tasks"
              onClick={() => navigate("tasks")}
            >
              <CheckSquare size={18} />
            </button>
          )}

          {/* Routines (if role allows) */}
          {visibleNav.some(n => n.key === "routines") && (
            <button
              className={`jq-icon-btn ${active === "routines" ? "active" : ""}`}
              title="Routines"
              onClick={() => navigate("routines")}
            >
              <Camera size={18} />
            </button>
          )}

          {/* Operations (if role allows) */}
          {visibleNav.some(n => n.key === "operations") && (
            <button
              className={`jq-icon-btn ${active === "operations" ? "active" : ""}`}
              title="Operations"
              onClick={() => navigate("operations")}
            >
              <ListChecks size={18} />
            </button>
          )}

          {/* Dark / light mode toggle */}
          <button
            className={`jq-icon-btn ${darkMode ? "active" : ""}`}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setDarkMode(d => !d)}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Grid menu toggle */}
          <button
            data-jq-toggle="menu"
            className={`jq-icon-btn ${menuOpen ? "active" : ""}`}
            title="Pages menu"
            onClick={() => { setMenuOpen(o => !o); setUserOpen(false); }}
          >
            <LayoutGrid size={20} />
          </button>

          {/* User avatar */}
          <button
            data-jq-toggle="user"
            className="jq-avatar-btn"
            title="Account"
            onClick={() => { setUserOpen(o => !o); setMenuOpen(false); }}
          >
            {(user.username || "S")[0].toUpperCase()}
          </button>
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="jq-main">
        <Page />
      </main>

      {/* ── Front Desk slide-in panel ── */}
      {fdPanel && (
        <FrontDeskPanel onClose={() => setFdPanel(false)} onNavigate={navigate} />
      )}

      {/* ── Grid dropdown — shows only allowed pages ── */}
      {menuOpen && (
        <>
          <div className="jq-menu-overlay" onClick={() => setMenuOpen(false)} />
          <div className="jq-menu-panel">
            <p className="jq-menu-section-title">MY PAGES</p>
            <div className="jq-menu-grid">
              {visibleNav.map(item => (
                <button
                  key={item.key}
                  className={`jq-menu-item ${active === item.key ? "active" : ""}`}
                  onClick={() => navigate(item.key)}
                >
                  <span className={`jq-menu-icon ${item.color}`}>
                    <item.icon size={18} />
                  </span>
                  <span className="jq-menu-item-text">
                    <p className="jq-menu-item-label">{item.label}</p>
                    <p className="jq-menu-item-sub">{item.sub}</p>
                  </span>
                  <ChevronRight size={14} className="jq-menu-item-arrow" />
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── User dropdown ── */}
      {userOpen && (
        <>
          <div className="jq-menu-overlay" onClick={() => setUserOpen(false)} />
          <div className="jq-user-panel">
            <p className="jq-user-name">{user.full_name || user.username}</p>
            <p className="jq-user-role">{userRoles.join(" · ")}</p>
            <button className="jq-user-logout" onClick={onLogout}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
