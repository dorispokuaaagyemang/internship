import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { GuestOnly, RequireActive, RequireAuth, RequireRole } from '../features/auth/guards';

// Each portal is its own chunk, loaded the first time one of its pages opens, so a student
// never downloads the company or admin code. Forms (React Hook Form, Zod) load with the first form.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));

const LoginPage = named(() => import('../features/auth/LoginPage'), 'LoginPage');
const RegisterPage = named(() => import('../features/auth/RegisterPage'), 'RegisterPage');
const VerifyPage = named(() => import('../features/auth/VerifyPage'), 'VerifyPage');
const AuthCompletePage = named(() => import('../features/auth/AuthCompletePage'), 'AuthCompletePage');
const AcceptInvitePage = named(() => import('../features/auth/AcceptInvitePage'), 'AcceptInvitePage');

const NotificationsPage = named(() => import('../features/notifications/NotificationsPage'), 'NotificationsPage');

const StudentDashboard = named(() => import('../features/student/StudentDashboard'), 'StudentDashboard');
const ProfilePage = named(() => import('../features/student/ProfilePage'), 'ProfilePage');
const SearchPage = named(() => import('../features/student/SearchPage'), 'SearchPage');
const PostingPage = named(() => import('../features/student/PostingPage'), 'PostingPage');
const ApplicationsPage = named(() => import('../features/student/ApplicationsPage'), 'ApplicationsPage');
const ApplicationPage = named(() => import('../features/student/ApplicationPage'), 'ApplicationPage');

const CompanyDashboard = named(() => import('../features/company/CompanyDashboard'), 'CompanyDashboard');
const PostingsPage = named(() => import('../features/company/PostingsPage'), 'PostingsPage');
const PostingFormPage = named(() => import('../features/company/PostingFormPage'), 'PostingFormPage');
const ApplicantsPage = named(() => import('../features/company/ApplicantsPage'), 'ApplicantsPage');
const ApplicantPage = named(() => import('../features/company/ApplicantPage'), 'ApplicantPage');

const AdminOverview = named(() => import('../features/admin/OverviewPage'), 'OverviewPage');
const AdminCompanies = named(() => import('../features/admin/CompaniesPage'), 'CompaniesPage');
const AdminUsers = named(() => import('../features/admin/UsersPage'), 'UsersPage');
const AdminAudit = named(() => import('../features/admin/AuditPage'), 'AuditPage');
const AccountPage = named(() => import('../features/account/AccountPage'), 'AccountPage');
const PrivacyPage = named(() => import('../features/account/PrivacyPage'), 'PrivacyPage');

const internship = (name) => named(() => import('../features/internships/pages'), name);
const StudentInternships = internship('StudentInternships');
const StudentInternship = internship('StudentInternship');
const CompanyInterns = internship('CompanyInterns');
const CompanyIntern = internship('CompanyIntern');
const SupervisorInterns = internship('SupervisorInterns');
const SupervisorIntern = internship('SupervisorIntern');
const StaffPage = named(() => import('../features/internships/StaffPage'), 'StaffPage');

// One SPA, four role portals (ARCHITECTURE.md §9). Guards: signed in -> verified -> role.
// The API enforces the same rules; these only decide what to show.
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />

        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route path="/auth/complete" element={<AuthCompletePage />} />
        {/* US-09: the link a company emails to a new supervisor. */}
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />

        {/* US-03: anyone can browse; applying needs a verified student (checked on the page and by the API). */}
        <Route path="/internships" element={<SearchPage />} />
        <Route path="/internships/:id" element={<PostingPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/verify" element={<VerifyPage />} />
          {/* Data protection rights apply to every account, verified or not. */}
          <Route path="/account" element={<AccountPage />} />

          <Route element={<RequireActive />}>
            <Route path="/notifications" element={<NotificationsPage />} />

            <Route element={<RequireRole roles={['student']} />}>
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:id" element={<ApplicationPage />} />
              <Route path="/my-internships" element={<StudentInternships />} />
              <Route path="/my-internships/:id" element={<StudentInternship />} />
            </Route>
            <Route element={<RequireRole roles={['company_rep']} />}>
              <Route path="/company" element={<CompanyDashboard />} />
              <Route path="/company/postings" element={<PostingsPage />} />
              <Route path="/company/postings/new" element={<PostingFormPage />} />
              <Route path="/company/postings/:id/edit" element={<PostingFormPage />} />
              <Route path="/company/postings/:id/applications" element={<ApplicantsPage />} />
              <Route path="/company/postings/:postingId/applications/:id" element={<ApplicantPage />} />
              <Route path="/company/interns" element={<CompanyInterns />} />
              <Route path="/company/interns/:id" element={<CompanyIntern />} />
              <Route path="/company/staff" element={<StaffPage />} />
            </Route>
            <Route element={<RequireRole roles={['supervisor']} />}>
              <Route path="/supervisor" element={<SupervisorInterns />} />
              <Route path="/supervisor/interns/:id" element={<SupervisorIntern />} />
            </Route>
            <Route element={<RequireRole roles={['admin']} />}>
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/companies" element={<AdminCompanies />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
