import { Link, Navigate } from 'react-router-dom';
import { homeFor, needsVerification, useAuth } from '../features/auth/auth-context';

export function HomePage() {
  const { status, user } = useAuth();
  if (status === 'signedIn') return <Navigate to={needsVerification(user) ? '/verify' : homeFor(user)} replace />;

  return (
    <main className="page hero">
      <h1>Find an internship. Find your next intern.</h1>
      <p className="hero__lead">
        Students search and apply to internships and follow every application. Companies post openings, shortlist
        candidates and supervise interns, all in one place.
      </p>
      <div className="inline-actions">
        <Link className="btn btn--primary" to="/register">
          Create an account
        </Link>
        <Link className="btn btn--secondary" to="/internships">
          Browse internships
        </Link>
      </div>
    </main>
  );
}
