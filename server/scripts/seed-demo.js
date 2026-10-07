// Fills the database with Ghanaian demo data for development and demos: an admin, companies in every
// state, their reps and supervisors, students, postings, applications in every status, and
// internships at each stage (US-01..US-12). Nothing here is real personal data.
//   npm run db:seed:demo -w server              adds the demo data (refuses if it is already there)
//   npm run db:seed:demo -w server -- --reset   removes it, then adds it again
//   npm run db:seed:demo -w server -- --remove  only removes it
// Every demo account is <name>@demo.example.com (example.com is reserved and receives no mail) and every demo company's registration number
// starts with DEMO-, which is how --remove finds them. It never touches other accounts. Skills
// are shared and stay. The password of every demo account is DEMO_PASSWORD, or Demo@2026.
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { config } from '../src/config/index.js';
import { addDays, todayISO } from '../src/lib/dates.js';
import {
  sequelize,
  User,
  StudentProfile,
  Skill,
  Company,
  CompanyMember,
  Posting,
  Application,
  ApplicationStatusHistory,
  Internship,
  SupervisorAssignment,
  Evaluation,
  Certificate,
  StoredFile,
  Notification,
} from '../src/db/models/index.js';
import { record } from '../src/modules/audit/service.js';
import { deleteObject } from '../src/integrations/storage.js';
import { generateCertificate } from '../src/modules/internships/service.js';

const DOMAIN = 'demo.example.com';
const REG_PREFIX = 'DEMO-';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026';
const mail = (local) => `${local}@${DOMAIN}`;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const today = todayISO();

// --- The demo world ---------------------------------------------------------------------------

const COMPANIES = [
  {
    key: 'volta',
    name: 'Volta Digital Labs',
    regNumber: 'DEMO-CS-100001',
    contactPhone: '+233302123401',
    website: 'https://volta-digital.example',
    status: 'verified',
    rep: ['kwame.asante', 'Kwame Asante', '+233244100201'],
    supervisors: [
      ['efua.owusu', 'Efua Owusu'],
      ['yaw.boateng', 'Yaw Boateng'],
    ],
  },
  {
    key: 'agritech',
    name: 'Gold Coast Agritech',
    regNumber: 'DEMO-CS-100002',
    contactPhone: '+233322045602',
    website: 'https://goldcoast-agritech.example',
    status: 'verified',
    rep: ['akosua.darko', 'Akosua Darko', '+233244100202'],
    supervisors: [['kofi.antwi', 'Kofi Antwi']],
  },
  {
    key: 'harbour',
    name: 'Harbour Logistics Ghana',
    regNumber: 'DEMO-CS-100003',
    contactPhone: '+233303208803',
    website: null,
    status: 'verified',
    rep: ['nii.lartey', 'Nii Lartey', '+233244100203'],
    supervisors: [['adwoa.sarpong', 'Adwoa Sarpong']],
  },
  // Waiting for an admin to approve it (US-04).
  {
    key: 'kente',
    name: 'Kente Creative Studio',
    regNumber: 'DEMO-CS-100004',
    contactPhone: '+233244556604',
    website: 'https://kente-creative.example',
    status: 'pending_verification',
    rep: ['abena.osei', 'Abena Osei', '+233244100204'],
    supervisors: [],
  },
  // Suspended by an admin (US-12).
  {
    key: 'sahel',
    name: 'Sahel Solar Ltd',
    regNumber: 'DEMO-CS-100005',
    contactPhone: '+233372022205',
    website: null,
    status: 'suspended',
    rep: ['ibrahim.mahama', 'Ibrahim Mahama', '+233244100205'],
    supervisors: [],
  },
];

// [email local part, full name, university, department, GPA, skills, phone]
const STUDENTS = [
  ['ama.mensah', 'Ama Mensah', 'University of Ghana', 'Computer Science', 3.72, ['JavaScript', 'React', 'SQL'], '+233241000101'],
  ['kojo.appiah', 'Kojo Appiah', 'Kwame Nkrumah University of Science and Technology', 'Computer Engineering', 3.45, ['Python', 'Node.js', 'SQL'], '+233241000102'],
  ['esi.quaye', 'Esi Quaye', 'Ashesi University', 'Management Information Systems', 3.88, ['Data Analysis', 'Excel', 'Python'], '+233241000103'],
  ['yaw.ofori', 'Yaw Ofori', 'University of Cape Coast', 'Agricultural Economics', 3.21, ['Data Analysis', 'Excel', 'Communication'], '+233241000104'],
  ['akua.boakye', 'Akua Boakye', 'University of Professional Studies, Accra', 'Accounting', 3.55, ['Accounting', 'Excel'], '+233241000105'],
  ['kwabena.adjei', 'Kwabena Adjei', 'Ghana Communication Technology University', 'Telecommunications Engineering', 3.1, ['Networking', 'Java'], '+233241000106'],
  ['afia.amponsah', 'Afia Amponsah', 'Ghana Institute of Management and Public Administration', 'Marketing', 3.62, ['Marketing', 'Graphic Design', 'Communication'], '+233241000107'],
  ['selorm.agbeko', 'Selorm Agbeko', 'Kwame Nkrumah University of Science and Technology', 'Logistics and Supply Chain Management', 3.4, ['Project Management', 'Excel'], '+233241000108'],
  ['fatima.alhassan', 'Fatima Alhassan', 'University for Development Studies', 'Computer Science', 3.05, ['Java', 'Mobile Development', 'JavaScript'], '+233241000109'],
];

const BIOS = {
  'ama.mensah': 'Final-year Computer Science student who enjoys building accessible web apps. Volunteer tutor at Code Club Accra.',
  'kojo.appiah': 'Computer Engineering student interested in APIs, databases and cloud infrastructure.',
  'esi.quaye': 'MIS student who turns messy spreadsheets into dashboards. Interested in fintech and agritech.',
  'yaw.ofori': 'Agricultural Economics student from the Bono Region with field survey experience.',
};

// [key, company, title, domain, location, weeks, stipend (GHS), status, deadline (days from today), skills]
// Every future date (deadlines, internship dates) is at least 4 weeks ahead, so the demo stays usable;
// only records that are over by definition (closed postings, ended internships) lie in the past.
const POSTINGS = [
  ['frontend', 'volta', 'Frontend Developer Intern', 'Software Engineering', 'Accra', 12, 1500, 'active', 35, ['JavaScript', 'React']],
  ['backend', 'volta', 'Backend Developer Intern (Node.js)', 'Software Engineering', 'Accra (hybrid)', 12, 1500, 'active', 42, ['Node.js', 'SQL', 'JavaScript']],
  ['mobile', 'volta', 'Mobile App Development Intern', 'Software Engineering', 'Accra', 10, 1200, 'draft', 60, ['Mobile Development', 'Java']],
  ['swe2026', 'volta', 'Software Engineering Intern, 2026 cohort', 'Software Engineering', 'Accra', 12, 1400, 'closed', -60, ['JavaScript', 'Node.js']],
  ['analyst', 'agritech', 'Data Analyst Intern', 'Data & Analytics', 'Kumasi', 16, 1200, 'active', 30, ['Data Analysis', 'Python', 'Excel']],
  ['field', 'agritech', 'Field Research Assistant', 'Agriculture', 'Kumasi and Ashanti Region', 8, 800, 'active', 28, ['Communication', 'Excel']],
  ['agribiz', 'agritech', 'Agribusiness Intern', 'Agriculture', 'Kumasi', 12, 1000, 'closed', -120, ['Data Analysis', 'Excel']],
  ['supply', 'harbour', 'Supply Chain Intern', 'Logistics', 'Tema', 12, 1000, 'active', 49, ['Project Management', 'Excel']],
  ['finance', 'harbour', 'Finance and Accounts Intern', 'Finance', 'Tema', 12, 1000, 'active', 56, ['Accounting', 'Excel']],
  ['itsupport', 'harbour', 'IT Support Intern', 'Information Technology', 'Tema', 10, 900, 'draft', 70, ['Networking']],
];

const DESCRIPTIONS = {
  'Software Engineering':
    'Join a product team building web services for Ghanaian businesses. You will pair with senior engineers, ship features behind code review, and present a demo at the end of the internship.',
  'Data & Analytics':
    'Help farmers and buyers make better decisions with data. You will clean survey and market-price data, build dashboards and write short weekly briefs for the operations team.',
  Agriculture:
    'Work with our field officers on smallholder farms: run surveys, record yields and support training sessions. Travel within the region is covered.',
  Logistics: 'Support the operations team at Tema Port: shipment tracking, warehouse reporting and process-improvement projects.',
  Finance: 'Assist the finance team with bookkeeping, reconciliations, payroll preparation and month-end reporting.',
  'Information Technology': 'Keep our offices running: helpdesk tickets, network maintenance, device setup and documentation.',
};

// [student, posting, final status, days since applying]
const APPLICATIONS = [
  ['ama.mensah', 'frontend', 'shortlisted', 6],
  ['ama.mensah', 'backend', 'interviewed', 12],
  ['kojo.appiah', 'backend', 'applied', 2],
  ['fatima.alhassan', 'frontend', 'applied', 1],
  ['kwabena.adjei', 'frontend', 'rejected', 9],
  ['afia.amponsah', 'frontend', 'withdrawn', 8],
  ['esi.quaye', 'analyst', 'interviewed', 10],
  ['yaw.ofori', 'field', 'applied', 3],
  ['akua.boakye', 'finance', 'shortlisted', 5],
  ['selorm.agbeko', 'supply', 'applied', 4],
  ['esi.quaye', 'supply', 'applied', 2],
  // Closed postings: the outcomes behind the internships below.
  ['kojo.appiah', 'swe2026', 'accepted', 75],
  ['fatima.alhassan', 'swe2026', 'accepted', 74],
  ['kwabena.adjei', 'swe2026', 'accepted', 100],
  ['afia.amponsah', 'swe2026', 'rejected', 70],
  ['yaw.ofori', 'agribiz', 'accepted', 140],
  ['esi.quaye', 'agribiz', 'rejected', 135],
];

const PATHS = {
  applied: ['applied'],
  shortlisted: ['applied', 'shortlisted'],
  interviewed: ['applied', 'shortlisted', 'interviewed'],
  accepted: ['applied', 'shortlisted', 'interviewed', 'accepted'],
  rejected: ['applied', 'rejected'],
  withdrawn: ['applied', 'withdrawn'],
};

const NOTES = {
  shortlisted: 'Strong profile. Invite to a first interview.',
  interviewed: 'Interview held; good technical answers.',
  accepted: 'Offer accepted.',
  rejected: 'Thank you for applying; we have chosen candidates closer to the role.',
};

const COVER_LETTER = (name, title) =>
  `Dear Hiring Team,\n\nI am applying for the ${title} position. My coursework and projects have prepared me to contribute from the first week, and I am eager to learn from your team.\n\nKind regards,\n${name}`;

// --- Removal ------------------------------------------------------------------------------------

async function removeDemo() {
  const users = await User.findAll({ where: { email: { [Op.like]: `%@${DOMAIN}` } }, attributes: ['id'], paranoid: false });
  const userIds = users.map((u) => u.id);
  const companyIds = (await Company.findAll({ where: { regNumber: { [Op.like]: `${REG_PREFIX}%` } }, attributes: ['id'] })).map((c) => c.id);
  if (!userIds.length && !companyIds.length) return false;

  const files = userIds.length ? await StoredFile.findAll({ where: { ownerUserId: userIds } }) : [];
  await sequelize.transaction(async (transaction) => {
    // Certificates first: their files are RESTRICT.
    if (files.length) await Certificate.destroy({ where: { fileId: files.map((f) => f.id) }, transaction });
    if (files.length) await StoredFile.destroy({ where: { id: files.map((f) => f.id) }, transaction });
    // The audit log is insert-only through the model; demo entries go with a plain query.
    const conditions = [];
    if (userIds.length) conditions.push('actor_id IN (:userIds)', "(entity_type = 'user' AND entity_id IN (:userIds))");
    if (companyIds.length) conditions.push("(entity_type = 'company' AND entity_id IN (:companyIds))");
    await sequelize.query(`DELETE FROM audit_logs WHERE ${conditions.join(' OR ')}`, { replacements: { userIds, companyIds }, transaction });
    // Postings, applications, internships, assignments and evaluations cascade from these.
    if (companyIds.length) await Company.destroy({ where: { id: companyIds }, transaction });
    if (userIds.length) await User.destroy({ where: { id: userIds }, force: true, transaction });
  });

  for (const file of files) {
    await deleteObject({ bucket: file.bucket, key: file.objectKey }).catch((err) => console.warn(`Could not delete ${file.objectKey}: ${err.message}`));
  }
  console.log(`Removed ${userIds.length} demo accounts, ${companyIds.length} demo companies and ${files.length} stored files.`);
  return true;
}

// --- Seeding ------------------------------------------------------------------------------------

async function seedDemo() {
  const passwordHash = await bcrypt.hash(PASSWORD, config.auth.bcryptCost);
  const accounts = {};
  const created = { internships: {} };

  await sequelize.transaction(async (transaction) => {
    const opts = { transaction };
    const makeUser = async (local, role, extra = {}) => {
      const user = await User.create(
        {
          email: mail(local),
          passwordHash,
          role,
          status: 'active',
          emailVerifiedAt: daysAgo(150),
          lastLoginAt: daysAgo(Math.floor(Math.random() * 10)),
          ...extra,
        },
        opts,
      );
      accounts[local] = user;
      return user;
    };

    const admin = await makeUser('admin', 'admin', { displayName: 'Platform Admin' });

    // Skills are shared with real data: reuse existing ones.
    const skillNames = new Set([...STUDENTS.flatMap((s) => s[5]), ...POSTINGS.flatMap((p) => p[9])]);
    const skills = {};
    for (const name of skillNames) {
      [skills[name]] = await Skill.findOrCreate({ where: { name }, defaults: { name }, transaction });
    }
    const skillsFor = (names) => names.map((n) => skills[n]);

    // Companies, reps and supervisors (US-04, US-09).
    const companies = {};
    const supervisorsOf = {};
    for (const c of COMPANIES) {
      const [repLocal, repName, repPhone] = c.rep;
      const rep = await makeUser(repLocal, 'company_rep', { displayName: repName, phoneE164: repPhone });
      const verified = c.status !== 'pending_verification';
      const company = await Company.create(
        {
          name: c.name,
          regNumber: c.regNumber,
          contactPhone: c.contactPhone,
          website: c.website,
          status: c.status,
          verifiedBy: verified ? admin.id : null,
          verifiedAt: verified ? daysAgo(160) : null,
        },
        opts,
      );
      companies[c.key] = company;
      await CompanyMember.create({ companyId: company.id, userId: rep.id, memberRole: 'rep', fullName: repName }, opts);
      supervisorsOf[c.key] = [];
      for (const [local, name] of c.supervisors) {
        const supervisor = await makeUser(local, 'supervisor', { displayName: name });
        await CompanyMember.create({ companyId: company.id, userId: supervisor.id, memberRole: 'supervisor', fullName: name }, opts);
        supervisorsOf[c.key].push(supervisor);
      }
      await record({ actor: rep, action: 'company.registered', entity: { type: 'company', id: company.id } }, opts);
      if (verified) await record({ actor: admin, action: 'admin.company_approved', entity: { type: 'company', id: company.id } }, opts);
      if (c.status === 'suspended') {
        await record(
          { actor: admin, action: 'admin.company_suspended', entity: { type: 'company', id: company.id }, metadata: { reason: 'Demo: unpaid stipends reported by interns' } },
          opts,
        );
      }
    }

    // Students with complete profiles (US-02).
    const profiles = {};
    for (const [local, name, university, department, gpa, skillList, phone] of STUDENTS) {
      const student = await makeUser(local, 'student', { displayName: name, phoneE164: phone });
      const profile = await StudentProfile.create({ userId: student.id, fullName: name, university, department, gpa, bio: BIOS[local] ?? null }, opts);
      await profile.setSkills(skillsFor(skillList), opts);
      profiles[local] = profile;
    }
    // Edge cases: email not confirmed yet, profile not filled in, suspended by an admin.
    await makeUser('nana.yeboah', 'student', { displayName: 'Nana Yeboah', status: 'pending', emailVerifiedAt: null, lastLoginAt: null });
    await makeUser('kofi.danso', 'student', { displayName: 'Kofi Danso' });
    const suspended = await makeUser('adjoa.frimpong', 'student', { displayName: 'Adjoa Frimpong', status: 'suspended' });
    await StudentProfile.create({ userId: suspended.id, fullName: 'Adjoa Frimpong', university: 'University of Ghana', department: 'Economics', gpa: 2.9 }, opts);
    await record(
      { actor: admin, action: 'admin.user_suspended', entity: { type: 'user', id: suspended.id }, metadata: { reason: 'Demo: fake documents' } },
      opts,
    );

    // Postings (US-05, US-06).
    const postings = {};
    for (const [key, companyKey, title, domain, location, durationWeeks, stipend, status, deadlineDays, skillList] of POSTINGS) {
      const companyDef = COMPANIES.find((c) => c.key === companyKey);
      const deadline = new Date(Date.now() + deadlineDays * DAY);
      const publishedAt = status === 'draft' ? null : new Date(Math.min(Date.now(), deadline.getTime()) - 30 * DAY);
      const posting = await Posting.create(
        {
          companyId: companies[companyKey].id,
          createdBy: accounts[companyDef.rep[0]].id,
          title,
          description: DESCRIPTIONS[domain],
          location,
          domain,
          durationWeeks,
          stipend,
          stipendCurrency: 'GHS',
          deadline,
          status,
          publishedAt,
          closedAt: status === 'closed' ? deadline : null,
        },
        opts,
      );
      await posting.setSkills(skillsFor(skillList), opts);
      postings[key] = posting;
    }

    // Applications with their status history (US-03, US-07, US-08).
    const applications = {};
    for (const [studentLocal, postingKey, status, appliedDaysAgo] of APPLICATIONS) {
      const posting = postings[postingKey];
      const student = accounts[studentLocal];
      const companyDef = COMPANIES.find((c) => companies[c.key].id === posting.companyId);
      const rep = accounts[companyDef.rep[0]];
      const appliedAt = daysAgo(appliedDaysAgo);
      const application = await Application.create(
        {
          postingId: posting.id,
          studentId: student.id,
          status,
          coverLetter: COVER_LETTER(profiles[studentLocal].fullName, posting.title),
          createdAt: appliedAt,
        },
        opts,
      );
      const path = PATHS[status];
      for (const [i, to] of path.entries()) {
        const byStudent = to === 'applied' || to === 'withdrawn';
        await ApplicationStatusHistory.create(
          {
            applicationId: application.id,
            fromStatus: i === 0 ? null : path[i - 1],
            toStatus: to,
            changedBy: byStudent ? student.id : rep.id,
            note: byStudent ? null : (NOTES[to] ?? null),
            createdAt: new Date(appliedAt.getTime() + i * 3 * DAY),
          },
          opts,
        );
      }
      applications[`${studentLocal}/${postingKey}`] = application;
    }

    // Internships (US-09..US-11), one at each stage.
    const efua = accounts['efua.owusu'];
    const yawB = accounts['yaw.boateng'];
    const kofi = accounts['kofi.antwi'];
    const volta = accounts['kwame.asante'];
    const agriRep = accounts['akosua.darko'];

    const internship = async (key, applicationKey, startOffset, weeks, status = 'ongoing', extra = {}) => {
      const startDate = addDays(today, startOffset);
      const row = await Internship.create(
        { applicationId: applications[applicationKey].id, startDate, endDate: addDays(startDate, weeks * 7 - 1), status, ...extra },
        opts,
      );
      created.internships[key] = row;
      return row;
    };
    const assign = (row, supervisor, by, assignedAt) =>
      SupervisorAssignment.create({ internshipId: row.id, supervisorUserId: supervisor.id, assignedBy: by.id, assignedAt }, opts);

    // 1. Ongoing, supervised, one progress evaluation so far.
    const ongoing = await internship('ongoing', 'kojo.appiah/swe2026', -30, 12);
    await assign(ongoing, efua, volta, daysAgo(29));
    await Evaluation.create(
      {
        internshipId: ongoing.id,
        supervisorId: efua.id,
        period: 'Weeks 1-4',
        rating: 4,
        comments: 'Settled in quickly and shipped two small features. Should ask for help sooner when blocked.',
        attendance: 'excellent',
        createdAt: daysAgo(2),
      },
      opts,
    );
    // 2. Starts in four weeks, no supervisor yet: the rep can assign one.
    await internship('unassigned', 'fatima.alhassan/swe2026', 28, 12);
    // 3. Ended two days ago without a final evaluation: the supervisor is reminded.
    const ended = await internship('ended', 'kwabena.adjei/swe2026', -85, 12);
    await assign(ended, yawB, volta, daysAgo(85));
    await Evaluation.create(
      {
        internshipId: ended.id,
        supervisorId: yawB.id,
        period: 'Month 1',
        rating: 3,
        comments: 'Reliable on support tasks; needs more practice with version control.',
        attendance: 'good',
        createdAt: daysAgo(55),
      },
      opts,
    );
    // 4. Completed with a final evaluation: the certificate is generated below.
    const completed = await internship('completed', 'yaw.ofori/agribiz', -100, 12, 'completed', { completedAt: daysAgo(10), completedBy: kofi.id });
    await assign(completed, kofi, agriRep, daysAgo(99));
    for (const [period, rating, comments, attendance, isFinal, ago] of [
      ['Month 1', 4, 'Careful with data collection and well liked by the farmers he surveyed.', 'excellent', false, 70],
      ['Month 2', 4, 'Produced the first draft of the yield dashboard on his own.', 'good', false, 40],
      ['Final', 5, 'Outstanding intern. His survey of 120 farms in the Ashanti Region shapes our next season. We would hire him.', 'excellent', true, 12],
    ]) {
      await Evaluation.create({ internshipId: completed.id, supervisorId: kofi.id, period, rating, comments, attendance, isFinal, createdAt: daysAgo(ago) }, opts);
    }
    await record({ actor: kofi, action: 'internship.completed', entity: { type: 'internship', id: completed.id } }, opts);

    // In-app notifications (US-03, US-07..US-10), some already read.
    const payload = (studentLocal, postingKey, extra = {}) => {
      const posting = postings[postingKey];
      const company = Object.values(companies).find((c) => c.id === posting.companyId);
      return {
        applicationId: applications[`${studentLocal}/${postingKey}`].id,
        postingId: posting.id,
        postingTitle: posting.title,
        companyName: company.name,
        ...extra,
      };
    };
    const internshipPayload = (row, studentLocal, postingKey, supervisorName) => ({
      internshipId: row.id,
      postingTitle: postings[postingKey].title,
      companyName: Object.values(companies).find((c) => c.id === postings[postingKey].companyId).name,
      studentName: profiles[studentLocal].fullName,
      supervisorName,
    });
    const notes = [
      ['ama.mensah', 'application.submitted', payload('ama.mensah', 'frontend', { status: 'applied' }), 6, true],
      ['ama.mensah', 'application.status_changed', payload('ama.mensah', 'frontend', { from: 'applied', to: 'shortlisted' }), 3, false],
      ['ama.mensah', 'application.status_changed', payload('ama.mensah', 'backend', { from: 'shortlisted', to: 'interviewed' }), 1, false],
      ['kwabena.adjei', 'application.status_changed', payload('kwabena.adjei', 'frontend', { from: 'applied', to: 'rejected' }), 6, false],
      ['kwame.asante', 'application.received', payload('fatima.alhassan', 'frontend'), 1, false],
      ['kwame.asante', 'application.received', payload('kojo.appiah', 'backend'), 2, false],
      ['kwame.asante', 'application.withdrawn', payload('afia.amponsah', 'frontend', { studentName: 'Afia Amponsah' }), 5, true],
      ['akosua.darko', 'application.received', payload('yaw.ofori', 'field'), 3, false],
      ['nii.lartey', 'application.received', payload('selorm.agbeko', 'supply'), 4, false],
      ['kojo.appiah', 'supervisor.assigned', internshipPayload(ongoing, 'kojo.appiah', 'swe2026', 'Efua Owusu'), 29, true],
      [
        'kojo.appiah',
        'evaluation.submitted',
        { internshipId: ongoing.id, period: 'Weeks 1-4', rating: 4, isFinal: false, postingTitle: postings.swe2026.title, companyName: companies.volta.name },
        2,
        false,
      ],
      ['efua.owusu', 'intern.assigned', internshipPayload(ongoing, 'kojo.appiah', 'swe2026', 'Efua Owusu'), 29, true],
      [
        'yaw.boateng',
        'internship.ended',
        { internshipId: ended.id, endDate: ended.endDate, postingTitle: postings.swe2026.title, studentName: 'Kwabena Adjei' },
        1,
        false,
      ],
      ['ibrahim.mahama', 'company.suspended', { companyId: companies.sahel.id, companyName: companies.sahel.name }, 20, true],
    ];
    for (const [local, type, data, ago, read] of notes) {
      await Notification.create({ userId: accounts[local].id, type, payload: data, readAt: read ? daysAgo(ago - 1) : null, createdAt: daysAgo(ago) }, opts);
    }
  });

  // The certificate PDF goes to storage, so it is made after the commit, as the worker would.
  try {
    const certificate = await generateCertificate(created.internships.completed.id);
    if (certificate) {
      await Notification.create({
        userId: accounts['yaw.ofori'].id,
        type: 'certificate.issued',
        payload: {
          internshipId: created.internships.completed.id,
          postingTitle: 'Agribusiness Intern',
          companyName: 'Gold Coast Agritech',
          serialNo: certificate.serialNo,
        },
      });
      console.log(`Certificate ${certificate.serialNo} issued for Yaw Ofori.`);
    }
  } catch (err) {
    console.warn(`The certificate could not be made now (${err.message}); the worker's certificates.sweep will issue it.`);
  }

  console.log(`\nDemo data added. Every account's password is ${PASSWORD}`);
  console.log(`  admin           ${mail('admin')}`);
  console.log(`  company rep     ${mail('kwame.asante')}  (Volta Digital Labs, verified)`);
  console.log(`  company rep     ${mail('abena.osei')}  (Kente Creative Studio, pending approval)`);
  console.log(`  supervisor      ${mail('efua.owusu')}  (supervises Kojo Appiah)`);
  console.log(`  supervisor      ${mail('kofi.antwi')}  (completed internship with a certificate)`);
  console.log(`  student         ${mail('ama.mensah')}  (shortlisted and interviewed applications)`);
  console.log(`  student         ${mail('kojo.appiah')}  (ongoing internship)`);
  console.log(`  student         ${mail('yaw.ofori')}  (completed internship, certificate)`);
  console.log(`  student         ${mail('kofi.danso')}  (profile not filled in)`);
  console.log(`  others          ${Object.keys(accounts).length} accounts in all, all @${DOMAIN}`);
}

// --- Entry point --------------------------------------------------------------------------------

if (config.env === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
let exitCode = 0;
try {
  if (args.has('--remove')) {
    if (!(await removeDemo())) console.log('No demo data found.');
  } else {
    if (args.has('--reset')) await removeDemo();
    if (await User.count({ where: { email: { [Op.like]: `%@${DOMAIN}` } }, paranoid: false })) {
      console.error('Demo data is already there. Run with --reset to recreate it, or --remove to delete it.');
      exitCode = 1;
    } else {
      await seedDemo();
    }
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await sequelize.close();
}
// The storage and queue clients keep sockets open; nothing else is pending.
process.exit(exitCode);
