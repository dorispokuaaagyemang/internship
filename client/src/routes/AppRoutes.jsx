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

const NotificationsPage = named(() => import('../features/notifications/NotificationsPage'), 'NotificationsPage');
const DashboardPage = named(() => import('../pages/DashboardPage'), 'DashboardPage');

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

const AdminDashboard = named(() => import('../features/admin/AdminDashboard'), 'AdminDashboard');

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

        {/* US-03: anyone can browse; applying needs a verified student (checked on the page and by the API). */}
        <Route path="/internships" element={<SearchPage />} />
        <Route path="/internships/:id" element={<PostingPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/verify" element={<VerifyPage />} />

          <Route element={<RequireActive />}>
            <Route path="/notifications" element={<NotificationsPage />} />

            <Route element={<RequireRole roles={['student']} />}>
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/applications/:id" element={<ApplicationPage />} />
            </Route>
            <Route element={<RequireRole roles={['company_rep']} />}>
              <Route path="/company" element={<CompanyDashboard />} />
              <Route path="/company/postings" element={<PostingsPage />} />
              <Route path="/company/postings/new" element={<PostingFormPage />} />
              <Route path="/company/postings/:id/edit" element={<PostingFormPage />} />
              <Route path="/company/postings/:id/applications" element={<ApplicantsPage />} />
              <Route path="/company/postings/:postingId/applications/:id" element={<ApplicantPage />} />
            </Route>
            <Route element={<RequireRole roles={['supervisor']} />}>
              <Route path="/supervisor" element={<DashboardPage />} />
            </Route>
            <Route element={<RequireRole roles={['admin']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
