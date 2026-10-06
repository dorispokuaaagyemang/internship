import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { homeFor, needsVerification, useAuth } from './auth-context';
import { PageLoading } from '../../components/ui';

// Signed-in users only; others go to /login and come back afterwards.
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (status === 'signedOut') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <Outlet />;
}

// US-00B: a pending account is sent to verification before anything else.
export function RequireActive() {
  const { user } = useAuth();
  if (needsVerification(user)) return <Navigate to="/verify" replace />;
  return <Outlet />;
}

// RBAC in the UI (the API enforces it too): another role is sent to its own home.
export function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}

// Only a path on this site, so ?next= can't send anyone elsewhere (open redirect).
const safeNext = (search) => {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
};

// Login and registration are for signed-out visitors. Signing in lands on ?next= if given.
export function GuestOnly() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (status === 'signedIn') {
    const to = needsVerification(user) ? '/verify' : (safeNext(location.search) ?? homeFor(user));
    return <Navigate to={to} replace />;
  }
  return <Outlet />;
}
