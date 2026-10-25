# IEM Admission System (MEAN POC)

A small, working proof-of-concept of an online college admission system, built
on the MEAN stack: **MongoDB, Express.js, Angular and Node.js**.

It is a scoped slice of a real admission portal, built to show one complete
request-response loop working end to end:

```
Angular form ──HTTP/JSON──▶ Express route (on Node) ──▶ Mongoose ──▶ MongoDB
     ▲                                                                  │
     └──────────── Angular updates the page ◀── JSON response ◀────────┘
```

> **Status: Phase 5 of 7 complete.** The full cycle works: register → apply → upload → submit → admin review → decision → applicant sees the new status.
> See [Roadmap](#roadmap) and [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md)
> for what each phase added and why every file exists.

---

## Contents
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup and running](#setup-and-running)
- [Running the tests](#running-the-tests)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Tech stack

| Layer | Technology | Role |
|---|---|---|
| Database | MongoDB 8.2 + Mongoose 9 | Stores JSON-like documents; Mongoose adds schemas and validation |
| Server runtime | Node.js 24 | Runs all server code |
| Back-end framework | Express 5 (runs inside Node) | Routing and middleware |
| Front end | Angular 22 (standalone components, signals, Router, HttpClient, Reactive Forms) | The UI in the browser |
| Auth | jsonwebtoken (JWT) + bcryptjs | Login tokens and password hashing |
| Validation | zod | Server-side input validation |
| File upload | multer | Streams the file to disk with a hard size limit; MongoDB gets only a reference |
| Config | dotenv, cors | Environment settings; allow only the Angular origin |
| Testing | Jest + supertest | Automated API tests, named after test-plan IDs |

The back end is plain JavaScript (CommonJS). The front end is TypeScript.

## Architecture

Three layers, matching the high-level design:

| Layer | What lives there |
|---|---|
| **Client** | One Angular app with applicant and admin views. Guards and form validation here are **UX only**. |
| **Application** | Express modules: Account Management, Application Management, Course Selection, Document Management, Application and Document Validation, Application Submission and Status, Fee Record Management, Application Review (admin). |
| **Data** | MongoDB collections: `users` (D1), `applications` (D2), `courses` (D3), `documents` (D4), `feerecords` (D5). Uploaded file bytes live on disk in `backend/uploads/`; MongoDB stores only metadata and a reference. |


### What each layer does in one request (example: "Save application")
1. **Angular** — the reactive form is valid, so `ApplicationService.update()` sends `PUT /api/applications/me` with JSON; the interceptor adds `Authorization: Bearer <token>`.
2. **Express on Node** — `verifyToken` checks the JWT and sets `req.user`; `requireRole('applicant')` checks the role; `validate(schema)` rejects bad or forbidden fields.
3. **Controller** — `updateMyApplication` builds a query filtered by `req.user.id` and `status: "Draft"`.
4. **Mongoose** — turns that into a MongoDB `findOneAndUpdate`, running schema validators.
5. **MongoDB** — updates the document atomically and returns it.
6. **Back to Angular** — Express sends `{ application }` as JSON; the component sets a signal and the page re-renders.

## Prerequisites
- **Node.js 20+** (developed on 24) and npm
- **MongoDB 8.2 or newer**, using one of:
  - Docker: `docker compose up -d` from the repo root (recommended)
  - a local `mongod` install
  - MongoDB Atlas free tier

> MongoDB 8.0 and older refuse to start on Linux kernel 6.19+, which is why
> `docker-compose.yml` pins `mongo:8.2`.

## Setup and running

```bash
git clone https://github.com/rue19/iem-admission.git
cd iem-admission

# 1. Database (skip if you use Atlas or a local mongod)
docker compose up -d

# 2. Back end
cd backend
npm install
cp .env.example .env     # then edit .env: set JWT_SECRET and ADMIN_PASSWORD
npm run seed             # creates the admin account + 4 courses (safe to re-run)
npm run dev              # API on http://localhost:3000  (check /api/health)

# 3. Front end (in a second terminal)
cd frontend
npm install
npm start                # UI on http://localhost:4200
```

### Environment variables (`backend/.env`)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 3000) |
| `MONGO_URI` | Development database connection string |
| `JWT_SECRET` | Long random string used to sign tokens. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `2h` |
| `CLIENT_ORIGIN` | The only browser origin CORS allows (Angular dev server) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The admin account created by `npm run seed` |
| `UPLOAD_DIR` | Folder for uploaded files, relative to `backend/` (default `uploads`) |
| `MONGO_URI_TEST` | Separate test database; **name must end in `_test`** because tests wipe it |

`.env` is git-ignored. Only `.env.example` is committed.

### Trying it out
1. Open http://localhost:4200, click **Register** and create an account. You land on the applicant dashboard.
2. Pick a course, enter a qualifying percentage and click **Create application**. The status badge shows **Draft**.
3. Click **Edit Application**, change something and save.
4. Click **Upload Documents**. Upload a PDF, JPG or PNG for Identity Proof and Academic Certificate; each slot shows **Valid**, or the server's reason it was rejected (wrong type, empty, over 5 MB, corrupted). Try an MP3 or a file over 5 MB to see the rejection messages.
5. Once both required documents are **Valid**, click **Submit Application**. You get your Application ID, the status becomes **Submitted**, and an application fee of ₹1,000 appears on the dashboard as **Pending**. Click **Pay fee (mock)** to mark it **Paid** (no real payment is taken).
6. Log out and log in as the seeded admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). You land on `/admin`. Search for the applicant by name, email or Application ID, or filter by status and course. Select the application to see its details, documents (**View** opens the file) and fee.
7. Move it to **Under Review** with **Update Status**, record an **entrance score**, tick **Information verified**, then **Approve** (or **Reject** / **Waitlisted**). Only the moves the server allows are enabled.
8. Log back in as the applicant and click **Track Status**: the badge shows the new status.
9. While logged in as an applicant, typing `/admin` in the address bar sends you back to `/dashboard`.

## Running the tests

```bash
cd backend
npm test        # MongoDB must be running
```

- Tests run against `MONGO_URI_TEST`, which is wiped between tests. The helper refuses to run against a database whose name doesn't end in `_test`.
- Test names start with test-plan IDs (`AUTH-06`, `APP-12`, `SEC-05`, ...), so each one maps back to the test plan. See [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md#test-index) for the full list.
- The test script runs Node with `--experimental-vm-modules`. The MongoDB driver loads Node's `os` module with a dynamic `import()`, which Jest only supports with that flag; without it, every database connection fails with *"Missing required sub-document 'driver'"*. Node prints an `ExperimentalWarning` about the flag, which is expected.

Front-end smoke test: `cd frontend && npx ng test --watch=false`.

## API reference

All responses are JSON. Errors always have the shape `{ "error": "message" }`
(validation errors also include `field`).

| Method and path | Who | Purpose | Phase |
|---|---|---|---|
| `GET /api/health` | public | API and database status (200 ok / 503 degraded) | 0 ✅ |
| `POST /api/auth/register` | public | Register. Role is **always** `applicant`; a `role` in the body is ignored | 1 ✅ |
| `POST /api/auth/login` | public | Returns `{ token, user }`; the JWT holds `{ id, role }` | 1 ✅ |
| `GET /api/auth/me` | logged in | The user the token belongs to | 1 ✅ |
| `GET /api/courses` | logged in | Course list for the dropdown | 2 ✅ |
| `POST /api/applications` | applicant | Create a Draft: `{ course, qualifyingPercent, sportsQuota? }` | 2 ✅ |
| `GET /api/applications/me` | applicant | My application (404 if not started) | 2 ✅ |
| `PUT /api/applications/me` | applicant | Edit my application, **only while Draft** | 2 ✅ |
| `POST /api/applications/me/documents` | applicant | Upload one document: multipart field `file` + `documentType` (`Identity Proof`, `Academic Certificate`, `Other`). 201 if valid; 400 with the reason if not | 3 ✅ |
| `GET /api/applications/me/documents` | applicant | My documents, their validity, and `requiredTypes` | 3 ✅ |
| `POST /api/applications/me/submit` | applicant | Submit. Allowed only for a Draft with a course, a qualifying % of 0–100, and **Valid** Identity Proof and Academic Certificate; otherwise 400 with `error` and every blocking `reasons`. On success: status `Submitted`, a `Pending` fee record, and `{ applicationId, application, feeRecord }` | 4 ✅ |
| `GET /api/fees/me` | applicant | My fee record (404 before submitting) | 4 ✅ |
| `POST /api/fees/me/pay` | applicant | **Mock** payment: Pending → Paid with a `MOCK-…` reference. No body is read; paying twice → 409 | 4 ✅ |
| `GET /api/admin/applications?status=&course=&q=` | admin | List, filter by status and/or course, and search `q` by Application ID, name or email (case-insensitive, regex characters treated literally) | 5 ✅ |
| `GET /api/admin/applications/:id` | admin | `{ application, documents, feeRecord, allowedNextStatuses }` | 5 ✅ |
| `PATCH /api/admin/applications/:id/status` | admin | `{ status }`, checked against the workflow; illegal → 409, unknown status → 400 | 5 ✅ |
| `PATCH /api/admin/applications/:id/entrance-score` | admin | `{ entranceScore }` (0–100), only while Submitted, Under Review or Waitlisted; otherwise 409 | 5 ✅ |
| `GET /api/admin/documents/:id/file` | admin | Opens an uploaded file (404 for rejected uploads, which have no file) | 5 ✅ |
| `GET /api/admin/dashboard` | admin | Counts by course and status (aggregation) | 6 |

### Status codes used
| Code | Meaning here |
|---|---|
| 400 | Input failed validation, contained a field the client may not set, or the application isn't ready to submit |
| 401 | No token, invalid token or expired token (or wrong login credentials) |
| 403 | Logged in, but the role isn't allowed on this route |
| 404 | The thing doesn't exist *for you* (e.g. no application yet) |
| 409 | Conflict with current state: duplicate email, second application, editing or uploading for a non-Draft, illegal status change, fee already paid |
| 503 | Health check: the database is not connected |

## Security model

All validation and access control happen **on the server**. The Angular
guards and form checks only improve the experience; anyone can call the API
directly with curl.

- **Passwords** are hashed with bcrypt (cost 10) and never returned. `passwordHash` has `select: false` and is also stripped from JSON output.
- **Login** gives the same error for an unknown email and a wrong password, so it can't be used to find out who has an account.
- **JWT** holds only `{ id, role }`, is verified on every protected request (algorithm pinned to HS256), and expires (default 2 h).
- **Role** comes only from the verified token, never from the request body. Public registration can never create an admin; the seed script is the only way to make one.
- **Admin routes**: every `/api/admin/*` route runs `verifyToken` + `requireRole('admin')`, so an applicant gets 403 on any of them, including made-up URLs. Admin status changes are atomic (`{ _id, status: <checked status> }`), so two admins deciding at once can't both win.
- **Ownership**: applicant routes have no `:id` parameter. Every query filters by `req.user.id`, so an applicant cannot even name another applicant's application.
- **Server-owned fields** (`status`, `entranceScore`, `meritScore`, `applicant`) are rejected with 400 if an applicant sends them (zod `.strict()`).
- **Submit and pay are atomic** (`status: "Draft"` / `feeStatus: "Pending"` are part of the update query), so double clicks or parallel requests succeed exactly once. If creating the fee record fails, the status is put back to Draft.
- **Draft-only editing** is a single atomic query (`{ applicant, status: "Draft" }`), so a submit can't slip in between "check" and "update".
- **CORS** allows only `CLIENT_ORIGIN`. The JSON body limit is 100 KB.
- Error responses never include stack traces.
- **Uploads** (Rule DU, checked in this order, first failure reported):
  1. type is PDF, JPG/JPEG or PNG;
  2. 0 < size ≤ 5,242,880 bytes (1 MB = 1,048,576 bytes, limit inclusive);
  3. the first bytes match the type (`%PDF`, `FF D8 FF`, `89 50 4E 47`).

  The size is the number of bytes actually received; multer stops reading at the limit, so an oversized file is never fully written. Files are stored under a random UUID name, never the user's file name (no path traversal). Every rejected or interrupted upload is deleted from disk. MongoDB stores metadata and a path only, never file bytes, and the path is never sent to the browser. Admins open files through an authenticated route that serves only from the upload folder, with `X-Content-Type-Options: nosniff`.

### Status workflow
Only these status changes exist. The map lives in `backend/src/services/statusWorkflow.js`,
and the status names in `backend/src/config/constants.js`.

```
Draft        → Submitted                          (applicant, via submit)
Submitted    → Under Review                       (admin)
Under Review → Approved | Rejected | Waitlisted   (admin)
Waitlisted   → Approved | Rejected                (admin)
Approved, Rejected: final
```
Every other change, including setting the same status again or moving out of
Approved or Rejected, is refused with **409**. The applicant can't write
`status` at all: the update endpoint rejects the field, and submit ignores
its body.

## Project structure

```
iem-admission/
├── docker-compose.yml           local MongoDB 8.2
├── docs/
│   └── DEVELOPMENT_LOG.md       phase-by-phase notes: every file and why
├── backend/
│   ├── .env.example             committed template for .env
│   ├── scripts/seed.js          creates the admin + courses
│   ├── src/
│   │   ├── server.js            entry: connect DB, then listen
│   │   ├── app.js               builds the Express app (no listen, so tests can import it)
│   │   ├── config/              env.js, db.js, constants.js
│   │   ├── models/              User, Course, Application, Document, FeeRecord (Mongoose schemas)
│   │   ├── validators/          zod schemas for request bodies
│   │   ├── middleware/          auth (verifyToken), requireRole, validate, upload (multer), errorHandler
│   │   ├── controllers/         request handlers
│   │   ├── routes/              URL → middleware → controller wiring
│   │   ├── services/            business rules: documentValidation (Rule DU), statusWorkflow, submissionGate
│   │   └── utils/httpError.js
│   ├── tests/                   Jest + supertest suites and helpers
│   └── uploads/                 uploaded files (git-ignored)
└── frontend/src/app/
    ├── core/                    AuthService, interceptor, guards, Application/Document/Fee/Admin services, models
    ├── pages/                   login, register, applicant-dashboard, document-upload, admin-review
    └── shared/                  status badge, API error helper
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `MongoDB cannot start: Linux kernel versions 6.19 ...` | Use MongoDB 8.2+ (the compose file already does) |
| `Missing required environment variable: JWT_SECRET` | `cp backend/.env.example backend/.env` and fill it in |
| Tests fail with `Missing required sub-document 'driver'` | Run tests with `npm test` (it adds `--experimental-vm-modules`), not bare `npx jest` |
| Tests say `Refusing to run tests against non-test database` | Make `MONGO_URI_TEST` end in `_test` |
| UI shows "Cannot reach the server" | Start the back end (`npm run dev` in `backend/`) |
| Health returns 503 | MongoDB isn't running: `docker compose up -d` |

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffolding, config, MongoDB connection, health route | ✅ |
| 1 | Users, register/login (bcrypt + JWT), `verifyToken`, `requireRole`, seed; Angular login, AuthService, interceptor, guards | ✅ |
| 2 | Course list, Draft application create/read/update; applicant dashboard | ✅ |
| 3 | Document upload (multer, validation service, disk cleanup); upload page; file-size tests | ✅ |
| 4 | Submission gating, fee record, mock payment, status workflow service | ✅ |
| 5 | Admin list/filter/review, status transitions, entrance score; admin review page | ✅ |
| 6 | Aggregation dashboard; eligibility and merit functions | ⏳ |
| 7 | Security/integration test pass, final docs, demo cheat-sheet | ⏳ |

**Out of scope:** real payment gateway, SMS/OTP, email (including password
reset), offer letters and admit cards, seat allotment, production deployment.
