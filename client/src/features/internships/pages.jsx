import { InternshipPage } from './InternshipPage';
import { InternshipsListPage } from './InternshipsListPage';

// Each role reaches the same internship screens from its own part of the app.

export const StudentInternships = () => (
  <InternshipsListPage
    title="My internships"
    showStudent={false}
    linkTo={(id) => `/my-internships/${id}`}
    empty="No internships yet. When a company accepts your application, it appears here."
  />
);
export const StudentInternship = () => <InternshipPage backTo="/my-internships" backLabel="My internships" />;

export const CompanyInterns = () => (
  <InternshipsListPage title="Interns" linkTo={(id) => `/company/interns/${id}`} empty="No interns yet. Accepting an applicant starts their internship." />
);
export const CompanyIntern = () => <InternshipPage backTo="/company/interns" backLabel="Interns" />;

// US-09, US-10: the supervisor's home is their list of current interns.
export const SupervisorInterns = () => (
  <InternshipsListPage title="My interns" linkTo={(id) => `/supervisor/interns/${id}`} empty="No interns are assigned to you yet." />
);
export const SupervisorIntern = () => <InternshipPage backTo="/supervisor" backLabel="My interns" />;
