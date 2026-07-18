import Home from './pages/Home.jsx';
import AdminApp from './admin/AdminApp.jsx';
import StaffApp from './admin/StaffApp.jsx';
import CheckIn from './pages/CheckIn.jsx';
import FeedbackPage from './pages/FeedbackPage.jsx';
import PlatformApp from './platform/PlatformApp.jsx';

export default function App() {
  const path = window.location.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return <AdminApp />;
  if (path === '/staff' || path.startsWith('/staff/')) return <StaffApp />;
  if (path === '/platform' || path.startsWith('/platform/')) return <PlatformApp />;
  if (path.startsWith('/check-in/')) return <CheckIn />;
  if (path.startsWith('/feedback/')) return <FeedbackPage />;
  return <Home />;
}
