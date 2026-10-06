import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';
import { Card } from '../components/ui';

const ROLE_NAMES = { student: 'Student', company_rep: 'Company representative', supervisor: 'Supervisor', admin: 'Admin' };

// A landing page per role until each portal's own dashboard replaces it.
export function DashboardPage() {
  const { user } = useAuth();
  return (
    <main className="page">
      <h1>Welcome</h1>
      <p className="muted">
        Signed in as {user.email} ({ROLE_NAMES[user.role] ?? user.role}).
      </p>
      <Card title="What's here so far">
        <p>
          Your account is verified. Updates about your activity appear under the bell and on the{' '}
          <Link to="/notifications">notifications page</Link>, live as they happen.
        </p>
      </Card>
    </main>
  );
}
