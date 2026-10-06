# User Stories & Acceptance Criteria — Internship Management Platform

*(System Engineer Perspective — Functional Requirements Documentation)*

---

## Module 1: Authentication & Account Security

### US-00A: Sign In with Google
**As a** student or company representative, **I want to** sign in using my Google account, **so that** I can access the platform quickly without creating a new password.

**Acceptance Criteria:**
- Given a user on the login/registration page, when they click "Sign in with Google," then they are redirected to Google's OAuth consent screen.
- Given successful Google authentication, when the user grants permission, then the system creates a new account (if one doesn't exist) using the Google email and name, or logs into an existing linked account.
- Given a Google email that already exists as a manually registered account, when the user signs in with Google, then the system links the Google identity to the existing account rather than creating a duplicate.
- Given the user denies permission on the Google consent screen, when they return to the platform, then login fails gracefully with a clear message and no account is created.
- Given a successful Google sign-in, when the session starts, then the user is issued the same role-based access (student/company) as a normal account.

### US-00B: SMS Verification (dropped)
> **Dropped on 2026-10-06:** an SMS gateway can't be used, so SMS OTP verification is out of scope. Accounts are activated by email verification instead (US-01); Google accounts are active at once, since Google has verified the email. Phone numbers are still collected and checked for a valid country code and format, but they are not verified. The original story is kept below for reference.

~~**As a** registering user (student or company), **I want to** verify my phone number via SMS OTP, **so that** my account identity is confirmed and secured.~~

**Acceptance Criteria (not implemented):**
- ~~Given a user enters a phone number during registration, when they submit it, then a 6-digit OTP is sent via SMS within 30 seconds.~~
- ~~Given an OTP is sent, when the user enters the correct code within the validity window (e.g., 5 minutes), then the phone number is marked "Verified" and registration proceeds.~~
- ~~Given an incorrect OTP is entered, when submitted, then the system rejects it, shows an error, and allows retry up to 5 attempts before temporarily locking the request.~~
- ~~Given an OTP expires, when the user attempts to use it, then the system rejects it and offers a "Resend OTP" option.~~
- ~~Given a "Resend OTP" request, when triggered, then the system enforces a cooldown period (e.g., 60 seconds) to prevent spam/abuse.~~
- ~~Given an unverified phone number, when the user attempts to log in or apply for internships, then the system blocks the action and prompts phone verification.~~
- Phone numbers must be validated for correct country code and format (still applies, at registration).

---

## Module 2: Student Management

### US-01: Student Registration
**As a** student, **I want to** register on the platform, **so that** I can create a profile and apply for internships.

**Acceptance Criteria:**
- Given a new user, when they enter name, email, password, and university details, then an account is created and a verification email is sent.
- Given an unverified email, when the student tries to log in, then the system blocks login and prompts email verification.
- Given a duplicate email, when registration is attempted, then the system rejects it with an error message.
- Password must be minimum 8 characters, including one number and one special character.
- Given a student registers with email and password, when they submit the form, then they must verify their email address before the account becomes active. (Originally SMS OTP as well; dropped, see US-00B.)
- Registration may alternatively be completed via **Sign in with Google** (see US-00A), in which case email/password is not required and the account is active at once.

### US-02: Student Profile Management
**As a** student, **I want to** build and edit my profile (resume, skills, academic info), **so that** companies can evaluate my suitability.

**Acceptance Criteria:**
- Given a logged-in student, when they upload a resume, then only PDF/DOCX files under 5MB are accepted.
- Given incomplete mandatory fields (name, university, department), when the student tries to save, then the system blocks saving and highlights missing fields.
- Given a saved profile, when the student updates any field, then changes are reflected immediately and a timestamp is logged.

### US-03: Browse & Apply to Internships
**As a** student, **I want to** search and apply to internship postings, **so that** I can find opportunities matching my skills.

**Acceptance Criteria:**
- Given active postings, when a student searches by keyword/location/domain, then matching results are returned within 2 seconds.
- Given a posting, when a student clicks "Apply," then the system checks profile completeness before allowing submission.
- Given a submitted application, when it is created, then its status is set to "Applied" and the student receives confirmation.
- Given a student has already applied to a posting, when they try to apply again, then the system prevents duplicate applications.

---

## Module 3: Company Management

### US-04: Company Registration & Verification
**As a** company representative, **I want to** register my organization, **so that** I can post internships.

**Acceptance Criteria:**
- Given a new company registration, when submitted, then the account status is set to "Pending Verification."
- Given a pending company, when an admin approves it, then the status changes to "Verified" and posting rights are enabled.
- Given an unverified company, when it attempts to post an internship, then the system blocks the action with an appropriate message.
- Given a company registers with email and password, when submitted, then the representative must verify their email address before the company can be registered and marked "Pending Verification". The company contact number is collected and format-checked. (Originally SMS OTP; dropped, see US-00B.)
- Registration may alternatively be completed via **Sign in with Google** (US-00A) for the representative's identity, in which case email/password is not required.

### US-05: Create Internship Posting
**As a** company, **I want to** create and publish internship postings, **so that** students can discover and apply.

**Acceptance Criteria:**
- Given a verified company, when they fill in title, description, duration, stipend, and required skills, then the posting is saved as "Draft."
- Given a draft posting, when the company clicks "Publish," then it becomes visible to students and status changes to "Active."
- Given a posting reaches its deadline, when the system date exceeds the deadline, then the posting auto-closes and stops accepting applications.

### US-06: Review Applications
**As a** company, **I want to** view and filter applications for my postings, **so that** I can shortlist candidates efficiently.

**Acceptance Criteria:**
- Given applications exist for a posting, when a company opens the dashboard, then applications are listed with student profile summaries.
- Given a company selects a candidate, when they update the status to "Shortlisted," "Interviewed," or "Rejected," then the student is notified automatically.
- Given multiple applications, when the company applies filters (skills, university, GPA), then only matching results are displayed.

---

## Module 4: Application Workflow

### US-07: Application Status Tracking
**As a** student, **I want to** track my application status in real time, **so that** I know where I stand in the process.

**Acceptance Criteria:**
- Given an application exists, when its status changes, then the student's dashboard updates without requiring a page refresh (or on next load, if not real-time).
- Given a status change occurs, when it happens, then a notification (email/in-app) is triggered to the student.
- Application status values are restricted to a defined set: Applied, Shortlisted, Interviewed, Accepted, Rejected, Withdrawn.

### US-08: Withdraw Application
**As a** student, **I want to** withdraw an application, **so that** I can cancel interest if my plans change.

**Acceptance Criteria:**
- Given an application in "Applied" or "Shortlisted" state, when the student clicks "Withdraw," then the status changes to "Withdrawn" and the company is notified.
- Given an application already "Accepted" or "Rejected," when withdrawal is attempted, then the system disables the withdraw option.

---

## Module 5: Supervisor Management

### US-09: Assign Supervisor to Intern
**As a** company, **I want to** assign a supervisor to an accepted intern, **so that** the intern's work can be monitored.

**Acceptance Criteria:**
- Given an accepted student, when a company assigns a supervisor from their staff list, then the supervisor gains access to that student's records.
- Given a supervisor is assigned, when the assignment is made, then both supervisor and student receive a notification.
- One supervisor can be linked to multiple interns; one intern is linked to exactly one active supervisor at a time.

### US-10: Track Intern Performance
**As a** supervisor, **I want to** log evaluations and progress notes for my assigned interns, **so that** performance is documented over time.

**Acceptance Criteria:**
- Given an assigned intern, when the supervisor submits a weekly/periodic evaluation form, then it is timestamped and stored against that intern's record.
- Given an evaluation is submitted, when saved, then it becomes visible to the student and company (read-only for the student).
- Mandatory evaluation fields: performance rating (1–5), comments, attendance status.

### US-11: Generate Completion Certificate
**As a** supervisor/admin, **I want to** issue a certificate upon successful internship completion, **so that** the student has proof of completion.

**Acceptance Criteria:**
- Given an internship's end date has passed and the final evaluation is submitted, when the supervisor confirms completion, then a certificate is auto-generated as a PDF.
- Given a certificate is generated, when created, then it is stored in the student's profile and a download link is emailed.
- Given the evaluation is incomplete, when certificate generation is attempted, then the system blocks it and shows a validation message.

---

## Module 6: Admin/System-Level

### US-12: Admin Oversight Dashboard
**As an** admin, **I want to** monitor all users, postings, and applications, **so that** I can ensure platform integrity.

**Acceptance Criteria:**
- Given the admin dashboard, when loaded, then it displays counts of active students, companies, postings, and applications.
- Given a flagged company or student account, when the admin suspends it, then that account loses login/posting/application privileges immediately.
- All admin actions (approve, suspend, delete) must be logged with admin ID and timestamp for audit purposes.

---

## Non-Functional Requirements (Supporting the Above Stories)

- **Security:** Role-based access control (RBAC), encrypted storage of resumes/personal data, OAuth 2.0 for Google sign-in, rate-limiting on the authentication endpoints.
- **Performance:** Search/list operations must respond within 2–3 seconds under normal load.
- **Auditability:** All admin actions and authentication events (login, email verification, Google sign-in) must be logged with timestamps.
- ~~**Reliability:** SMS OTP delivery success rate should be monitored; fallback to email OTP if SMS delivery fails repeatedly.~~ (Dropped with US-00B.)
- **Compliance:** Phone numbers and Google profile data handled per applicable data protection regulations (e.g., GDPR/local equivalent).

---

## Implementation Notes

- Each user story above should map to a corresponding **use case diagram** and **API endpoint** during system design.
- Google Sign-In requires integration with **Google Identity Services (OAuth 2.0)**.
- ~~SMS Verification requires integration with an SMS gateway provider (e.g., Twilio, Africa's Talking, or similar) for OTP dispatch.~~ (Dropped with US-00B.)