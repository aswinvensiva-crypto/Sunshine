/**
 * adminContext.js — shared helpers for every admin page.
 * Re-exports API calls, provides useApi hook, toast system, and formatters.
 */
import { useState, useEffect, useCallback } from "react";
import {
  getToken, clearSession, login, setSession, getUser,
  getEmployeeToken, clearEmployeeSession, employeeLogin, setEmployeeSession, getEmployeeUser,
  adminDashboard, adminBookings, setBookingStatus,
  adminCalendar, adminRooms, adminAvailableRooms, setRoomStatus, setRoomRate,
  adminGuests, adminLookupGuestByKyc, adminDeleteGuest, adminGuestBookings,
  adminExpenses, addExpense, adminUsers, addUser,
  adminCreateBooking, adminGetBooking, adminUpdateBooking,
  adminAddGuest, adminUpdateGuest,
  blockUser, deleteUser, deleteBooking, deleteExpense,
  deleteEmployee, deleteTask, setEmployeeCredentials,
} from "../api/client.js";

export {
  getToken, clearSession, login, setSession, getUser,
  getEmployeeToken, clearEmployeeSession, employeeLogin, setEmployeeSession, getEmployeeUser,
  adminDashboard, adminBookings, setBookingStatus,
  adminCalendar, adminRooms, adminAvailableRooms, setRoomStatus, setRoomRate,
  adminGuests, adminLookupGuestByKyc, adminDeleteGuest, adminGuestBookings,
  adminExpenses, addExpense, adminUsers, addUser,
  adminCreateBooking, adminGetBooking, adminUpdateBooking,
  adminAddGuest, adminUpdateGuest,
  blockUser, deleteUser, deleteBooking, deleteExpense,
  deleteEmployee, deleteTask, setEmployeeCredentials,
};

// ── formatters ────────────────────────────────────────────────────
export const rupee   = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
export const todayISO = () => new Date().toISOString().slice(0, 10);

// ── toast system ──────────────────────────────────────────────────
let _setToasts = null;
export function initToaster(setter) { _setToasts = setter; }
export function notify(msg, type = "info") {
  if (!_setToasts) { console.log(`[${type}] ${msg}`); return; }
  const id = Date.now();
  _setToasts(ts => [...ts, { id, msg, type }]);
  setTimeout(() => _setToasts(ts => ts.filter(t => t.id !== id)), 3500);
}

// ── data-loading hook ─────────────────────────────────────────────
export function useApi(fn, deps = []) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true); setError("");
    fn()
      .then(setData)
      .catch(e => {
        if (e?.status === 401) {
          if (getToken()) { clearSession(); } else { clearEmployeeSession(); }
          window.location.reload();
        }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

// ── direct API fetcher (for pages that call the new resort endpoints) ──
export async function apiFetch(path, opts = {}) {
  const token = getToken() || getEmployeeToken();
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    if (getToken()) { clearSession(); } else { clearEmployeeSession(); }
    window.location.reload();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}
