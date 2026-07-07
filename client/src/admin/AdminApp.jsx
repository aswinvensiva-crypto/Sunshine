import './admin.css';
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Menu, ChevronDown, Plus, PenLine, History,
  Moon, Sun, LayoutGrid, LogOut, ChevronRight, X,
  LayoutDashboard, ConciergeBell, Zap, Scale, Sparkles,
  Users, CheckSquare, Camera, ClipboardList, Bell, BookOpen,
  Banknote, Clock, Star, ReceiptText, Home, ListChecks, ArrowLeftRight,
} from "lucide-react";
import { login, setSession, getUser, getToken, clearSession, initToaster } from "./adminContext.js";
import LoginPage from "./LoginPage.jsx";
import ShortcutLayer from "../components/ShortcutLayer.jsx";
import Breadcrumbs from "../components/Breadcrumbs.jsx";

import Dashboard        from "./Dashboard.jsx";
import CalendarView     from "./Calendar.jsx";
import FrontDesk        from "./FrontDesk.jsx";
import PricingHub       from "./PricingHub.jsx";
import Accounts         from "./Accounts.jsx";
import AddExpense       from "./AddExpense.jsx";
import Bookings         from "./Bookings.jsx";
import Staff            from "./Staff.jsx";
import ShiftMaster      from "./ShiftMaster.jsx";
import Tasks            from "./Tasks.jsx";
import Routines         from "./Routines.jsx";
import Operations       from "./Operations.jsx";
import Authentication   from "./Authentication.jsx";
import RoomTypes        from "./RoomTypes.jsx";
import DailyPayments    from "./DailyPayments.jsx";
import SpecialRequests  from "./SpecialRequests.jsx";
import FeedbackAdmin        from "./FeedbackAdmin.jsx";
import CheckoutExtendPage   from "./CheckoutExtendPage.jsx";
import Guests               from "./Guests.jsx";

/* ── Navigation groups for the grid dropdown ── */
const MENU_GROUPS = [
  {
    section: "RESERVATIONS & OPERATIONS",
    items: [
      { key:"calendar",        label:"Tape Chart",            sub:"Visual room grid",             icon:LayoutGrid,      color:"jq-ic-indigo" },
      { key:"bookings",        label:"Bookings",              sub:"All reservations",             icon:ClipboardList,   color:"jq-ic-purple" },
      { key:"checkout-extend", label:"Checkout / Extend",     sub:"Early checkout & extend stay", icon:ArrowLeftRight,  color:"jq-ic-indigo" },
      { key:"roomtypes",       label:"Room Types",            sub:"Categories & grid",            icon:LayoutGrid,      color:"jq-ic-yellow" },
      { key:"specialrequests", label:"Special Requests",      sub:"Early/late & fees",            icon:Clock,           color:"jq-ic-orange" },
    ],
  },
  {
    section: "FINANCE",
    items: [
      { key:"pricing",       label:"Availability & Rates", sub:"Manage inventory and pricing", icon:Zap,    color:"jq-ic-red"    },
      { key:"accounts",      label:"Accounts",       sub:"Reconciliation",      icon:Scale,       color:"jq-ic-teal"   },
      { key:"dailypayments", label:"Daily Payments", sub:"Owner verification",  icon:Banknote,    color:"jq-ic-green"  },
      { key:"addexpense",    label:"Add Expense",    sub:"Track expenses",      icon:ReceiptText, color:"jq-ic-orange" },
    ],
  },
  {
    section: "OPERATIONS",
    items: [
      { key:"tasks",     label:"Tasks",     sub:"Housekeeping & to-dos",  icon:CheckSquare, color:"jq-ic-blue"   },
      { key:"routines",  label:"Routines",  sub:"Recurring checklists",   icon:Camera,      color:"jq-ic-teal"   },
      { key:"operations",label:"Operations",sub:"Room & maintenance ops", icon:ListChecks,  color:"jq-ic-purple" },
    ],
  },
  {
    section: "ANALYTICS & SETTINGS",
    items: [
      { key:"dashboard",      label:"Dashboard",     sub:"Live overview",            icon:LayoutDashboard, color:"jq-ic-pink"   },
      { key:"guests",         label:"Guests",        sub:"Guest directory & KYC",    icon:Users,           color:"jq-ic-blue"   },
      { key:"staff",          label:"Staff",         sub:"Shifts & directory",       icon:Users,           color:"jq-ic-green"  },
      { key:"shiftmaster",    label:"Shift Master",  sub:"Default shift times",      icon:BookOpen,        color:"jq-ic-indigo" },
      { key:"authentication", label:"Notifications", sub:"Email & WhatsApp log",     icon:Bell,            color:"jq-ic-blue"   },
      { key:"feedback",       label:"Feedback",      sub:"Guest satisfaction",       icon:Star,            color:"jq-ic-yellow" },
    ],
  },
];

/* Quick-access tabs always visible in the strip */
const QUICK_TABS = [
  { key:"dashboard",  label:"Dashboard",  icon:Home          },
  { key:"frontdesk",  label:"Front Desk", icon:ConciergeBell },
  { key:"tasks",      label:"Tasks",      icon:CheckSquare   },
  { key:"routines",   label:"Routines",   icon:Camera        },
  { key:"operations", label:"Operations", icon:ClipboardList },
];

/* Top navigation dropdown menus */
const TOP_NAV_DROPDOWNS = [
  {
    key: "reservation",
    label: "Reservation",
    items: [
      { key:"bookings",        label:"Bookings",           icon:ClipboardList  },
      { key:"frontdesk",       label:"Front Desk",          icon:ConciergeBell },
      { key:"checkout-extend", label:"Checkout / Extend",   icon:ArrowLeftRight },
      { key:"roomtypes",       label:"Room Types",          icon:LayoutGrid    },
      { key:"specialrequests", label:"Special Requests",    icon:Clock         },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    items: [
      { key:"pricing",       label:"Availability & Rates", icon:Zap      },
      { key:"accounts",      label:"Accounts",        icon:Scale      },
      { key:"dailypayments", label:"Daily Payments",  icon:Banknote   },
      { key:"addexpense",    label:"Add Expense",     icon:ReceiptText },
    ],
  },
  {
    key: "operation",
    label: "Operation",
    items: [
      { key:"calendar",   label:"Tape Chart",  icon:LayoutGrid  },
      { key:"tasks",      label:"Tasks",       icon:CheckSquare },
      { key:"routines",   label:"Routines",    icon:Camera      },
      { key:"operations", label:"Operations",  icon:ListChecks  },
      { key:"staff",      label:"Staff",       icon:Users       },
      { key:"shiftmaster",label:"Shift Master",icon:BookOpen    },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    items: [
      { key:"dashboard",     label:"Dashboard",     icon:LayoutDashboard },
      { key:"guests",        label:"Guests",        icon:Users           },
      { key:"feedback",      label:"Feedback",      icon:Star            },
      { key:"authentication",label:"Notifications", icon:Bell            },
    ],
  },
];

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

/* ── Root ── */
export default function AdminApp() {
  const [authed, setAuthed] = useState(!!getToken());
  const [toasts, setToasts] = useState([]);
  initToaster(setToasts);

  return (
    <>
      {authed
        ? <AdminShell onLogout={() => { clearSession(); window.location.href = '/'; }} />
        : <LoginPage
            subtitle="Resort Management System"
            hint={<>Default: <b>admin</b> / <b>admin123</b></>}
            onLogin={async (u, p) => { const { token, user } = await login(u, p); setSession(token, user); setAuthed(true); }}
          />
      }
      <Toaster toasts={toasts} />
    </>
  );
}

/* ── Front Desk slide-in panel ── */
function FrontDeskPanel({ onClose, onNavigate, dark }) {
  /* Close on Escape */
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

/* ── Admin shell ── */
function AdminShell({ onLogout }) {
  const user = getUser();
  const [active,          setActive]          = useState("dashboard");
  const [navParams,       setNavParams]       = useState({});
  const [menuOpen,        setMenuOpen]        = useState(false);
  const [userOpen,        setUserOpen]        = useState(false);
  const [darkMode,        setDarkMode]        = useState(false);
  const [activeDropdown,  setActiveDropdown]  = useState(null);

  const navigate = (key, params = {}) => {
    setActive(key);
    setNavParams(params);
    setMenuOpen(false);
    setUserOpen(false);
    setActiveDropdown(null);
  };

  /* Closes any shell-owned overlay (grid menu, user panel, nav dropdown).
     Used by the global Esc handler in ShortcutLayer — returns true if
     something was actually open, so Esc doesn't also navigate up. */
  const closeOverlays = useCallback(() => {
    if (menuOpen || userOpen || activeDropdown) {
      setMenuOpen(false); setUserOpen(false); setActiveDropdown(null);
      return true;
    }
    return false;
  }, [menuOpen, userOpen, activeDropdown]);

  /* Shared close-timer for hover-intent nav dropdowns: leaving a trigger or
     panel doesn't close immediately — it schedules a close, so moving the
     cursor to another open menu (or back into the same one) cancels it
     instead of flickering. */
  const dropdownCloseTimer = useRef(null);
  const openDropdown = useCallback((key) => {
    clearTimeout(dropdownCloseTimer.current);
    setActiveDropdown(key);
  }, []);
  const scheduleCloseDropdown = useCallback(() => {
    clearTimeout(dropdownCloseTimer.current);
    dropdownCloseTimer.current = setTimeout(() => setActiveDropdown(null), 160);
  }, []);
  useEffect(() => () => clearTimeout(dropdownCloseTimer.current), []);

  /* Close dropdown panels on outside click */
  useEffect(() => {
    if (!menuOpen && !userOpen && !activeDropdown) return;
    const handler = (e) => {
      if (!e.target.closest(".jq-menu-panel") &&
          !e.target.closest(".jq-user-panel") &&
          !e.target.closest("[data-jq-toggle]") &&
          !e.target.closest(".jq-nav-dropdown")) {
        setMenuOpen(false); setUserOpen(false); setActiveDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, userOpen, activeDropdown]);

  const Page = () => {
    const props = { onNavigate: navigate, navParams };
    switch (active) {
      case "calendar":         return <CalendarView     {...props} />;
      case "dashboard":        return <Dashboard        {...props} />;
      case "frontdesk":        return <FrontDesk        {...props} />;
      case "pricing":          return <PricingHub       {...props} />;
      case "accounts":         return <Accounts         {...props} />;
      case "addexpense":       return <AddExpense       {...props} />;
      case "bookings":         return <Bookings         {...props} />;
      case "staff":            return <Staff            {...props} />;
      case "shiftmaster":      return <ShiftMaster      {...props} />;
      case "tasks":            return <Tasks            {...props} />;
      case "routines":         return <Routines         {...props} />;
      case "operations":       return <Operations       {...props} />;
      case "dailypayments":    return <DailyPayments    {...props} />;
      case "authentication":   return <Authentication   {...props} />;
      case "rooms":
      case "roomtypes":        return <RoomTypes        {...props} />;
      case "specialrequests":  return <SpecialRequests    {...props} />;
      case "feedback":         return <FeedbackAdmin      {...props} />;
      case "checkout-extend":  return <CheckoutExtendPage {...props} />;
      case "guests":           return <Guests             {...props} />;
      default:                 return <Dashboard          {...props} />;
    }
  };

  return (
    <div className="jq-shell" data-theme={darkMode ? "dark" : "light"}>
      {/* ── Top Bar ── */}
      <header className="jq-topbar">
        {/* Left: brand */}
        <div className="jq-topbar-left">
          <Sparkles size={16} className="jq-logo-icon" />
          <span className="jq-logo">Sunshine</span>
        </div>

        {/* Centre: dropdown nav buttons */}
        <nav className="jq-topbar-nav">
          {TOP_NAV_DROPDOWNS.map(menu => {
            const isGroupActive = menu.items.some(i => i.key === active);
            const isOpen = activeDropdown === menu.key;
            return (
              <div
                key={menu.key}
                className={`jq-nav-dropdown ${isOpen ? "open" : ""}`}
                onMouseEnter={() => openDropdown(menu.key)}
                onMouseLeave={scheduleCloseDropdown}
              >
                <span className={`jq-nav-link ${isGroupActive ? "active" : ""} ${isOpen ? "open" : ""}`}>
                  <button className="jq-nav-link-label" onClick={() => navigate(menu.items[0].key)}>
                    {menu.label}
                  </button>
                  <button
                    className="jq-nav-caret"
                    aria-label={`Toggle ${menu.label} menu`}
                    aria-expanded={isOpen}
                    onClick={() => (isOpen ? setActiveDropdown(null) : openDropdown(menu.key))}
                  >
                    <ChevronDown size={13} className={`jq-nav-chevron ${isOpen ? "rotated" : ""}`} />
                  </button>
                </span>
                {isOpen && (
                  <div
                    className="jq-nav-dropdown-menu"
                    onMouseEnter={() => openDropdown(menu.key)}
                    onMouseLeave={scheduleCloseDropdown}
                  >
                    {menu.items.map(item => (
                      <button
                        key={item.key}
                        className={`jq-nav-dropdown-item ${active === item.key ? "active" : ""}`}
                        onClick={() => navigate(item.key)}
                      >
                        <item.icon size={15} className="jq-nav-dropdown-icon" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Right: more menu + user info */}
        <div className="jq-topbar-right">
          <span className="ff-shortcut-hint">Press <kbd className="ff-kbd">?</kbd> for shortcuts</span>

          {/* All pages grid menu */}
          <button
            data-jq-toggle="menu"
            className={`jq-icon-btn ${menuOpen ? "active" : ""}`}
            title="All pages"
            onClick={() => { setMenuOpen(o => !o); setUserOpen(false); }}
          >
            <LayoutGrid size={18} />
          </button>

          {/* User info + avatar */}
          <button
            data-jq-toggle="user"
            className="jq-user-info-btn"
            title="Account"
            onClick={() => { setUserOpen(o => !o); setMenuOpen(false); }}
          >
            <div className="jq-user-details">
              <span className="jq-user-name-label">{user.full_name || user.username}</span>
              <span className="jq-user-role-label">Sunshine Resort</span>
            </div>
            <div className="jq-avatar-btn">
              {(user.username || "A")[0].toUpperCase()}
            </div>
          </button>
        </div>
      </header>

      <Breadcrumbs activeKey={active} escBackTo={navParams?.escBackTo} onNavigate={navigate} />

      {/* ── Page content ── */}
      <main className="jq-main">
        <Page />
      </main>

      <ShortcutLayer
        navigate={navigate}
        activeKey={active}
        escBackTo={navParams?.escBackTo}
        closeOverlays={closeOverlays}
      />

      {/* ── Grid dropdown menu ── */}
      {menuOpen && (
        <>
          <div className="jq-menu-overlay" onClick={() => setMenuOpen(false)} />
          <div className="jq-menu-panel">
            {MENU_GROUPS.map(group => (
              <div key={group.section} className="jq-menu-section">
                <p className="jq-menu-section-title">{group.section}</p>
                <div className="jq-menu-grid">
                  {group.items.map(item => (
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
            ))}
          </div>
        </>
      )}

      {/* ── User dropdown ── */}
      {userOpen && (
        <>
          <div className="jq-menu-overlay" onClick={() => setUserOpen(false)} />
          <div className="jq-user-panel">
            <p className="jq-user-name">{user.full_name || user.username}</p>
            <p className="jq-user-role">{user.role} · Administrator</p>
            <button className="jq-theme-toggle" onClick={() => setDarkMode(d => !d)}>
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
              {darkMode ? "Light mode" : "Dark mode"}
            </button>
            <button className="jq-user-logout" onClick={onLogout}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
