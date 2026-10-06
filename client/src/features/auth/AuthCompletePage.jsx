import { Navigate } from 'react-router-dom';
import { PageLoading } from '../../components/ui';
import { homeFor, needsVerification, useAuth } from './auth-context';

// US-00A: Google sends the browser back here with the refresh cookie set. The AuthProvider
// has already exchanged it for a session on load; this page only decides where to go.
export function AuthCompletePage() {
  const { status, user } = useAuth();
  if (status === 'loading') return <PageLoading />;
  if (status === 'signedOut') return <Navigate to="/login?error=google_failed" replace />;
  return <Navigate to={needsVerification(user) ? '/verify' : homeFor(user)} replace />;
}
