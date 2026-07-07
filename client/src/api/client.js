// Tiny fetch wrapper around the backend API.
const j = async (r) => {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const err = new Error(body.error || r.statusText);
    err.status = r.status;
    throw err;
  }
  return r.json();
};

/* ---------- token storage (admin session) ---------- */
export const getToken = () => localStorage.getItem('ma_token');
export const setSession = (token, user) => {
  localStorage.setItem('ma_token', token);
  localStorage.setItem('ma_user', JSON.stringify(user || {}));
};
export const getUser = () => { try { return JSON.parse(localStorage.getItem('ma_user') || '{}'); } catch { return {}; } };
export const clearSession = () => { localStorage.removeItem('ma_token'); localStorage.removeItem('ma_user'); };

const auth = () => ({ Authorization: `Bearer ${getToken() || getEmployeeToken()}` });

/* ---------- token storage (employee / staff portal session) ---------- */
export const getEmployeeToken = () => localStorage.getItem('emp_token');
export const setEmployeeSession = (token, employee) => {
  localStorage.setItem('emp_token', token);
  localStorage.setItem('emp_user', JSON.stringify(employee || {}));
};
export const getEmployeeUser = () => { try { return JSON.parse(localStorage.getItem('emp_user') || '{}'); } catch { return {}; } };
export const clearEmployeeSession = () => { localStorage.removeItem('emp_token'); localStorage.removeItem('emp_user'); };

const empAuth = () => ({ Authorization: `Bearer ${getEmployeeToken()}` });

/* ---------- public (guest) ---------- */
export const getRooms = () => fetch('/api/rooms').then(j);
export const checkAvailability = (check_in, check_out, guests) =>
  fetch(`/api/availability?check_in=${check_in}&check_out=${check_out}&guests=${guests}`).then(j);
export const createBooking = (payload) =>
  fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);

/* ---------- auth ---------- */
export const login = (username, password) =>
  fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(j);

/* ---------- admin ---------- */
export const adminDashboard = () => fetch('/api/admin/dashboard', { headers: auth() }).then(j);
export const adminBookings  = (q = '') => fetch(`/api/admin/bookings${q}`, { headers: auth() }).then(j);
export const setBookingStatus = (id, status) =>
  fetch(`/api/admin/bookings/${id}/status`, { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).then(j);
export const adminCalendar  = (month) => fetch(`/api/admin/calendar?month=${month}`, { headers: auth() }).then(j);
export const adminRooms     = () => fetch('/api/admin/rooms', { headers: auth() }).then(j);
export const adminAvailableRooms = (room_type_id, check_in, check_out) =>
  fetch(`/api/admin/rooms/available?room_type_id=${room_type_id}&check_in=${check_in}&check_out=${check_out}`, { headers: auth() }).then(j);
export const setRoomStatus  = (id, status) =>
  fetch(`/api/admin/rooms/${id}/status`, { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }).then(j);
export const setRoomRate    = (payload) =>
  fetch('/api/admin/rooms/rate', { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const adminCreateBooking = (payload) =>
  fetch('/api/admin/bookings/new', { method:'POST', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(j);
export const adminGetBooking = (id) => fetch(`/api/admin/bookings/${id}`, { headers: auth() }).then(j);
export const adminUpdateBooking = (id, payload) =>
  fetch(`/api/admin/bookings/${id}`, { method:'PUT', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(j);
export const adminAddGuest = (payload) =>
  fetch('/api/admin/guests', { method:'POST', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(j);
export const adminUpdateGuest = (id, payload) =>
  fetch(`/api/admin/guests/${id}`, { method:'PUT', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify(payload) }).then(j);
export const adminGuests    = () => fetch('/api/admin/guests', { headers: auth() }).then(j);
export const adminDeleteGuest = (id) =>
  fetch(`/api/admin/guests/${id}`, { method:'DELETE', headers: auth() }).then(j);
export const adminGuestBookings = (id) =>
  fetch(`/api/admin/guests/${id}/bookings`, { headers: auth() }).then(j);
export const adminLookupGuestByKyc = (kyc_number) =>
  fetch(`/api/admin/guests/by-kyc?kyc_number=${encodeURIComponent(kyc_number)}`, { headers: auth() }).then(j);
export const adminExpenses  = () => fetch('/api/admin/expenses', { headers: auth() }).then(j);
export const addExpense     = (payload) =>
  fetch('/api/admin/expenses', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const adminUsers     = () => fetch('/api/admin/users', { headers: auth() }).then(j);
export const addUser        = (payload) =>
  fetch('/api/admin/users', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const blockUser      = (id, is_blocked) =>
  fetch(`/api/admin/users/${id}/block`, { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ is_blocked }) }).then(j);
export const deleteUser     = (id) =>
  fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers: auth() }).then(j);
export const deleteBooking  = (id) =>
  fetch(`/api/admin/bookings/${id}`, { method: 'DELETE', headers: auth() }).then(j);
export const deleteExpense  = (id) =>
  fetch(`/api/admin/expenses/${id}`, { method: 'DELETE', headers: auth() }).then(j);
export const deleteEmployee = (id) =>
  fetch(`/api/admin/employees/${id}`, { method: 'DELETE', headers: auth() }).then(j);
export const deleteTask     = (id) =>
  fetch(`/api/admin/tasks/${id}`, { method: 'DELETE', headers: auth() }).then(j);
export const adminDailyPayments = (date) =>
  fetch(`/api/admin/daily-payments?date=${date}`, { headers: auth() }).then(j);
export const verifyPayment  = (id) =>
  fetch(`/api/admin/bookings/${id}/verify-payment`, { method: 'PATCH', headers: auth() }).then(j);
export const sendInvoice    = (id) =>
  fetch(`/api/admin/bookings/${id}/send-invoice`, { method: 'POST', headers: auth() }).then(j);

/* ---------- employee portal ---------- */
export const employeeLogin = (username, password) =>
  fetch('/api/employee/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(j);

export const setEmployeeCredentials = (id, payload) =>
  fetch(`/api/admin/employees/${id}/credentials`, { method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);

/* ---------- overbooking / conflict ---------- */
export const checkConflict = (payload) =>
  fetch('/api/admin/bookings/check-conflict', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const adminConflictLog = () => fetch('/api/admin/conflict-log', { headers: auth() }).then(j);

/* ---------- refunds ---------- */
export const earlyCheckout = (id, payload) =>
  fetch(`/api/admin/bookings/${id}/early-checkout`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const createRefund = (id, payload) =>
  fetch(`/api/admin/bookings/${id}/refund`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const markRefundProcessed = (id, payload) =>
  fetch(`/api/admin/bookings/${id}/refund-processed`, { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);

/* ---------- early checkout preview & extend stay ---------- */
export const earlyCheckoutPreview = (id, actual_checkout) =>
  fetch(`/api/admin/bookings/${id}/early-checkout/preview?actual_checkout=${actual_checkout}`, { headers: auth() }).then(j);
export const extendAvailability = (id, new_checkout) =>
  fetch(`/api/admin/bookings/${id}/extend/availability?new_checkout=${new_checkout}`, { headers: auth() }).then(j);
export const extendStay = (id, payload) =>
  fetch(`/api/admin/bookings/${id}/extend`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);

/* ---------- checkout day notifications ---------- */
export const dueCheckoutsToday = () => fetch('/api/admin/bookings/due-checkout-today', { headers: auth() }).then(j);
export const notifyGuestCheckout = (id) =>
  fetch(`/api/admin/bookings/${id}/notify-checkout`, { method: 'POST', headers: auth() }).then(j);

/* ---------- special requests ---------- */
export const adminSpecialRequests = (status = '') =>
  fetch(`/api/admin/special-requests${status ? `?status=${status}` : ''}`, { headers: auth() }).then(j);
export const adminCreateSpecialRequest = (payload) =>
  fetch('/api/admin/special-requests', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
export const adminUpdateSpecialRequest = (id, payload) =>
  fetch(`/api/admin/special-requests/${id}`, { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(j);
