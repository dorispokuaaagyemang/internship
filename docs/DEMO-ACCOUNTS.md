# Demo accounts

Created by `npm run db:seed:demo -w server` (`-- --reset` to recreate, `-- --remove` to delete).
The script is `server/scripts/seed-demo.js`, and it refuses to run in production mode.

**Password for every account:** `Demo@2026` (or the value of `DEMO_PASSWORD` when seeding).

The addresses are on the reserved domain `demo.example.com`, so no email is ever sent to them; emails
for these accounts appear in the API/worker log instead. Sign in with email and password, not Google.

## Admin

| Email | Notes |
|---|---|
| admin@demo.example.com | Platform admin: approve companies, suspend users, audit log |

## Company representatives

| Email | Name | Company | Notes |
|---|---|---|---|
| kwame.asante@demo.example.com | Kwame Asante | Volta Digital Labs (Accra) | Verified; most applications and interns |
| akosua.darko@demo.example.com | Akosua Darko | Gold Coast Agritech (Kumasi) | Verified; has a completed intern |
| nii.lartey@demo.example.com | Nii Lartey | Harbour Logistics Ghana (Tema) | Verified |
| serwaa.badu@demo.example.com | Serwaa Badu | Sika Microfinance (Takoradi) | Verified |
| dede.tetteh@demo.example.com | Dede Tetteh | Osu Media House (Accra) | Verified |
| abena.osei@demo.example.com | Abena Osei | Kente Creative Studio | Pending admin approval: cannot post yet |
| ibrahim.mahama@demo.example.com | Ibrahim Mahama | Sahel Solar Ltd | Company suspended by an admin |

## Supervisors

| Email | Name | Company | Notes |
|---|---|---|---|
| efua.owusu@demo.example.com | Efua Owusu | Volta Digital Labs | Supervises Kojo Appiah (ongoing internship) |
| yaw.boateng@demo.example.com | Yaw Boateng | Volta Digital Labs | Supervises Kwabena Adjei (ended, final evaluation missing) |
| kofi.antwi@demo.example.com | Kofi Antwi | Gold Coast Agritech | Supervised Yaw Ofori (completed, certificate issued) |
| adwoa.sarpong@demo.example.com | Adwoa Sarpong | Harbour Logistics Ghana | No interns yet |
| kwesi.mensah@demo.example.com | Kwesi Mensah | Sika Microfinance | No interns yet |
| edem.kpodo@demo.example.com | Edem Kpodo | Osu Media House | No interns yet |

## Students

| Email | Name | University | Notes |
|---|---|---|---|
| ama.mensah@demo.example.com | Ama Mensah | University of Ghana | Shortlisted and interviewed applications |
| kojo.appiah@demo.example.com | Kojo Appiah | KNUST | Ongoing internship at Volta, with an evaluation |
| esi.quaye@demo.example.com | Esi Quaye | Ashesi University | Interviewed for Data Analyst; other applications |
| yaw.ofori@demo.example.com | Yaw Ofori | University of Cape Coast | Completed internship: certificate to download |
| akua.boakye@demo.example.com | Akua Boakye | UPSA | Shortlisted for Finance and Accounts |
| kwabena.adjei@demo.example.com | Kwabena Adjei | GCTU | Internship ended, waiting for the final evaluation |
| afia.amponsah@demo.example.com | Afia Amponsah | GIMPA | Withdrew one application, rejected from another |
| selorm.agbeko@demo.example.com | Selorm Agbeko | KNUST | One pending application |
| fatima.alhassan@demo.example.com | Fatima Alhassan | University for Development Studies | Accepted; internship starts in 4 weeks, no supervisor yet |
| kofi.danso@demo.example.com | Kofi Danso | — | Profile not filled in: cannot apply yet |
| nana.yeboah@demo.example.com | Nana Yeboah | — | Email not verified: sent to the verify page |
| adjoa.frimpong@demo.example.com | Adjoa Frimpong | — | Suspended by an admin: sign-in refused |
