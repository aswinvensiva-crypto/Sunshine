/**
 * nav.js — page label map + hierarchy helpers.
 *
 * Sunshine's admin panel has no URL router (see AdminApp.jsx): every page is a
 * peer, switched via local `active` state. There is no nested route tree to
 * walk, so the "hierarchy" is flat — Dashboard is the root and every other
 * page's parent is Dashboard, unless a specific drill-down passes
 * `navParams.escBackTo` to point back at the page it was opened from.
 */

export const PAGE_LABELS = {
  dashboard:        "Dashboard",
  frontdesk:        "Front Desk",
  pricing:          "Availability & Rates",
  accounts:         "Accounts",
  staff:            "Staff",
  tasks:            "Tasks",
  routines:         "Routines",
  operations:       "Operations",
  calendar:         "Tape Chart",
  bookings:         "Bookings",
  "checkout-extend":"Checkout / Extend",
  roomtypes:        "Room Types",
  rooms:            "Room Types",
  specialrequests:  "Special Requests",
  addexpense:       "Add Expense",
  dailypayments:    "Daily Payments",
  shiftmaster:      "Shift Master",
  authentication:   "Notifications",
  feedback:         "Feedback",
  guests:           "Guests",
};

export function labelOf(key) {
  return PAGE_LABELS[key] || key;
}

/** Root page — Esc / breadcrumbs bottom out here. */
export const ROOT_KEY = "dashboard";

/**
 * Parent of `key` in the (flat) page hierarchy, honoring an explicit
 * `escBackTo` override for drill-downs. Returns null when `key` is already
 * the root (nothing to go up to).
 */
export function parentOf(key, escBackTo) {
  if (escBackTo && escBackTo !== key) return escBackTo;
  if (!key || key === ROOT_KEY) return null;
  return ROOT_KEY;
}

/** Breadcrumb trail (array of {key,label}) for the given active page. */
export function trailFor(key, escBackTo) {
  if (!key || key === ROOT_KEY) return [];
  const trail = [{ key: ROOT_KEY, label: labelOf(ROOT_KEY) }];
  if (escBackTo && escBackTo !== ROOT_KEY && escBackTo !== key) {
    trail.push({ key: escBackTo, label: labelOf(escBackTo) });
  }
  trail.push({ key, label: labelOf(key) });
  return trail;
}
