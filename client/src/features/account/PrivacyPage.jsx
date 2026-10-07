import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

const months = (days) => Math.round(days / 30.4);

// The privacy notice (Kenya Data Protection Act 2019 / GDPR). Retention periods and the contact
// address come from the server, so the notice always matches what the system actually does.
// Have it reviewed by someone qualified before launch.
export function PrivacyPage() {
  const { data } = useQuery({
    queryKey: ['privacy-info'],
    queryFn: async () => (await api.get('/account/privacy-info')).data,
    staleTime: Infinity,
  });
  const r = data?.retention;
  const contact = data?.contactEmail;

  return (
    <main className="page page--medium prose-page">
      <h1>Privacy notice</h1>
      <p className="muted">How the Internship Platform collects, uses and protects your personal data.</p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Account:</strong> your name, email address, phone number and a securely hashed password (or your Google identity: name and email
          only). Used to sign you in and contact you about your account.
        </li>
        <li>
          <strong>Students:</strong> university, department, GPA, skills, a short bio, your resume, cover letters and applications. Shared with a
          company only when you apply to its internship.
        </li>
        <li>
          <strong>Internships:</strong> dates, your supervisor, evaluations and your completion certificate. Visible to you, the company and your
          supervisor.
        </li>
        <li>
          <strong>Companies and staff:</strong> company name, registration number and contact phone; staff names and work emails.
        </li>
        <li>
          <strong>Security log:</strong> sign-ins and administrative actions with time and IP address, to protect accounts and investigate misuse.
        </li>
      </ul>
      <p>
        We use one cookie, needed to keep you signed in. There is no advertising or tracking. Google sign-in asks Google only for your name and
        email address.
      </p>

      <h2>Who can see it</h2>
      <p>
        Only the people the platform needs to involve: companies see applications made to them, supervisors see their interns, and administrators
        can see accounts to verify companies and handle misuse. Files such as resumes and certificates are stored encrypted and opened only through
        short-lived links after an access check.
      </p>

      <h2>How long we keep it</h2>
      {r ? (
        <ul>
          <li>
            Accounts not used for {months(r.inactiveAccountDays)} months are deleted. We email you {r.warningDaysBefore} days before; signing in
            keeps your account.
          </li>
          <li>A student's resume is deleted after {months(r.inactiveResumeDays)} months without sign-in.</li>
          <li>Accounts whose email address is never confirmed are deleted after {r.unverifiedAccountDays} days.</li>
          <li>Security log entries are deleted after {months(r.auditLogDays)} months.</li>
        </ul>
      ) : (
        <p className="muted">Loading…</p>
      )}
      <p>
        “Deleted” means your personal data is erased. Records other people rely on, such as a company's list of past applications, are kept
        without your details and shown as “Deleted user”.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>See your data:</strong> download everything we hold about you from your <Link to="/account">account page</Link>.
        </li>
        <li>
          <strong>Correct it:</strong> edit your profile at any time, or ask us.
        </li>
        <li>
          <strong>Delete it:</strong> delete your account from your <Link to="/account">account page</Link>; it takes effect at once.
        </li>
        <li>
          <strong>Object or complain:</strong> contact us first; you can also complain to the data protection authority in your country (in Kenya,
          the Office of the Data Protection Commissioner).
        </li>
      </ul>

      <h2>Contact</h2>
      <p>{contact ? <>Questions or requests: <a href={`mailto:${contact}`}>{contact}</a>.</> : 'Contact the platform administrator.'}</p>
    </main>
  );
}
