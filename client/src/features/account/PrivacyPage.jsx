import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Change this date whenever the notice changes in substance.
const LAST_UPDATED = '7 October 2026';
const months = (days) => Math.round(days / 30.4);

// The privacy notice (Kenya Data Protection Act 2019 / GDPR). The controller, contact address and
// retention periods come from the server, so the notice matches what the system actually does.
// docs/DATA-PROTECTION.md is the reviewer's pack; have this reviewed before launch.
export function PrivacyPage() {
  const { data } = useQuery({
    queryKey: ['privacy-info'],
    queryFn: async () => (await api.get('/account/privacy-info')).data,
    staleTime: Infinity,
  });
  const r = data?.retention;
  const controller = data?.controller ?? 'The operator of this platform';
  const contact = data?.contactEmail;
  const contactLink = contact ? <a href={`mailto:${contact}`}>{contact}</a> : 'the platform administrator';

  return (
    <main className="page page--medium prose-page">
      <h1>Privacy notice</h1>
      <p className="muted">Last updated {LAST_UPDATED}.</p>

      <h2>Who is responsible</h2>
      <p>
        {controller} is responsible for your personal data on the Internship Platform (the “data controller”). For any question or request about
        your data, contact {contactLink}.
      </p>

      <h2>What we collect, why, and on what basis</h2>
      <table className="table table--dense">
        <thead>
          <tr>
            <th scope="col">Purpose</th>
            <th scope="col">Data</th>
            <th scope="col">Legal basis</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Your account and signing in</td>
            <td>Name, email address, phone number, a securely hashed password; or your Google name and email if you use Google sign-in</td>
            <td>Providing the service you signed up for</td>
          </tr>
          <tr>
            <td>Applying for internships</td>
            <td>University, department, GPA, skills, bio, resume, cover letters, application status</td>
            <td>Providing the service, at your request: a company sees an application only when you send it</td>
          </tr>
          <tr>
            <td>Running internships</td>
            <td>Dates, your supervisor, evaluations, completion certificate</td>
            <td>Providing the service to you and the host company</td>
          </tr>
          <tr>
            <td>Companies and their staff</td>
            <td>Company name, registration number, contact phone; staff names and work emails</td>
            <td>Providing the service; verifying that companies are genuine</td>
          </tr>
          <tr>
            <td>Emails and notifications</td>
            <td>Your email address and the events they are about</td>
            <td>Providing the service</td>
          </tr>
          <tr>
            <td>Security and misuse</td>
            <td>Sign-ins and administrative actions, with time and IP address</td>
            <td>Our legitimate interest in keeping accounts and the platform safe</td>
          </tr>
        </tbody>
      </table>
      <p>
        Name, email address and password are needed to create an account, and full name, university and department to apply for internships;
        everything else is optional. We use one cookie, needed to keep you signed in. There is no advertising or tracking.
      </p>

      <h2>Who receives it</h2>
      <ul>
        <li>Companies you apply to, and the supervisor of your internship.</li>
        <li>Platform administrators, to verify companies and handle misuse.</li>
        <li>
          Service providers who run parts of the platform for us, under our instructions: hosting and database, file storage, and email delivery;
          and Google, if you choose Google sign-in.
        </li>
      </ul>
      <p>
        Some of these providers may store or process data outside Kenya. We only use providers that protect personal data to the standard the law
        requires, with appropriate safeguards in place. Ask us for details of where your data is kept.
      </p>

      <h2>How we protect it</h2>
      <p>
        Data travels encrypted (HTTPS). Passwords are stored only as secure hashes. Resumes and certificates are stored encrypted and can be opened
        only through short-lived links after an access check. Access is limited by role, and administrative actions are logged. If a breach puts
        your data at risk, we will tell the Data Commissioner and, where the law requires, you.
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
          <li>Backups are kept for up to {Math.round(data.backupRetentionDays / 7)} weeks, so deleted data also leaves them within that time.</li>
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
          <strong>Be informed and see your data:</strong> this notice, and a download of everything we hold about you on your{' '}
          <Link to="/account">account page</Link>.
        </li>
        <li>
          <strong>Correct it:</strong> edit your profile at any time, or ask us.
        </li>
        <li>
          <strong>Delete it:</strong> delete your account on your <Link to="/account">account page</Link>; it takes effect at once.
        </li>
        <li>
          <strong>Object or restrict:</strong> ask us at {contactLink}; we respond within the time the law requires.
        </li>
        <li>
          <strong>Complain:</strong> to us first if you can, and to the data protection authority (in Kenya, the Office of the Data Protection
          Commissioner).
        </li>
      </ul>

      <h2>Changes</h2>
      <p>If this notice changes in a way that matters, we will tell you by email or in the app before the change takes effect.</p>
    </main>
  );
}
