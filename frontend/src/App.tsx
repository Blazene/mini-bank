import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { SessionProvider, useSession } from './context/Session';
import { Workspace } from './components/Workspace';
import { Auth } from './pages/Auth';
import { Overview } from './pages/Overview';
import { Accounts } from './pages/Accounts';
import { Payments } from './pages/Payments';
import { Activity } from './pages/Activity';
import { Loans } from './pages/Loans';
function Guard() {
  const { user } = useSession();
  return user ? <Workspace /> : <Navigate to="/login" replace />;
}
function RouteTree() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById('main-content')?.focus({ preventScroll: true });
    const view = location.pathname.split('/').at(-1) || 'Mini Bank';
    document.title = `${view === 'login' ? 'Welcome' : view[0].toUpperCase() + view.slice(1)} · Mini Bank`;
  }, [location.pathname]);
  // Keep demo and authenticated state isolated when moving between workspaces.
  const pages = (
    <>
      <Route index element={<Navigate to="overview" replace />} />
      <Route path="overview" element={<Overview />} />
      <Route path="accounts" element={<Accounts />} />
      <Route path="payments" element={<Payments />} />
      <Route path="activity" element={<Activity />} />
      <Route path="loans" element={<Loans />} />
      <Route path="*" element={<Navigate to="overview" replace />} />
    </>
  );
  return (
    <Routes location={location}>
      <Route path="/login" element={<Auth />} />
      <Route path="/app" element={<Guard key="live" />}>
        {pages}
      </Route>
      <Route path="/demo" element={<Workspace key="preview" />}>
        {pages}
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
export function AppRoutes() {
  return (
    <SessionProvider>
      <RouteTree />
    </SessionProvider>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
