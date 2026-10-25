# Development log

What each phase added, what every file does and **why** it is written the
way it is. Read this before the lab demo: you should be able to explain any
line of the code.

- [Phase 0 — Scaffolding](#phase-0--scaffolding)
- [Phase 1 — Accounts and login](#phase-1--accounts-and-login)
- [Phase 2 — Courses and Draft applications](#phase-2--courses-and-draft-applications)
- [Test index](#test-index)
- [Problems hit and how they were solved](#problems-hit-and-how-they-were-solved)

---

## Phase 0 — Scaffolding

**Goal:** an empty but wired-up project, where the browser can reach Express
and Express can reach MongoDB.

### Back end
| File | What it does and why |
|---|---|
| `src/config/env.js` | Loads `.env` once and exports one settings object. Missing `MONGO_URI` or `JWT_SECRET` stops the server **at startup** with a clear message, instead of failing in the middle of a request. No other file reads `process.env` for these. |
| `src/config/db.js` | `connectDB` / `disconnectDB` wrap Mongoose. `dbStatus()` turns Mongoose's numeric `readyState` (0–3) into words for the health route. `strictQuery` makes queries on fields that aren't in the schema fail instead of being silently ignored. |
| `src/app.js` | Builds the Express app: CORS (only the Angular origin) → JSON body parser (100 KB limit; files will use multer) → routes → 404 → error handler. It does **not** call `listen()`. That separation lets supertest import the app without opening a port. |
| `src/server.js` | Entry point. Connects to MongoDB **first**, then listens, so the API never accepts requests it can't serve. Exits with an error message if the connection fails. |
| `src/routes/health.js` | `GET /api/health` returns 200 `ok` when the database is connected and 503 `degraded` when it isn't. |
| `src/middleware/errorHandler.js` | `notFound` returns 404 JSON for unknown routes. `errorHandler` gives every error the same `{ error }` shape, turns malformed JSON into 400, and hides internals on 500. Express recognises an error handler by its **four** parameters, so the unused `next` must stay. |
| `.env.example` | The committed template; `.env` itself is git-ignored. |

### Repo root
| File | Why |
|---|---|
| `.gitignore` | Keeps `node_modules`, `.env` and uploaded files out of git. |
| `docker-compose.yml` | One command for a local MongoDB 8.2 with a named volume, so data survives restarts. |

### Front end
Generated with `ng new` (Angular 22, standalone components, no SSR).
`src/environments/environment.ts` is the single place the API URL lives.

---

## Phase 1 — Accounts and login

**Goal:** register, log in, receive a JWT, and have the server check identity
and role on protected routes. The Angular side stores the token and sends it
automatically.

### Back end
| File | What it does and why |
|---|---|
| `src/config/constants.js` | Roles and application statuses in one place, so a rename (e.g. "Approved" → "Selected") is a one-line change. |
| `src/models/User.js` | One collection for both applicants and admins, with a `role` field. In the class diagram both inherit from User and have the same fields, so a single collection is simpler. `email` is `unique`, so **MongoDB** rejects duplicates even if two requests race. `passwordHash` is protected twice: `select: false` (never loaded unless asked for) and a `toJSON` transform that deletes it from every response. |
| `src/models/Course.js` | Created here because the seed script inserts courses. |
| `src/validators/authSchemas.js` | zod rules for register and login. The register schema has **no `role` field**, and zod drops unknown keys, so a forged `role` never reaches the controller. The password maximum is 72 because bcrypt ignores anything after 72 bytes. |
| `src/middleware/validate.js` | `validate(schema)` checks `req.body`. On failure it returns 400 with the first message and the field name; on success it **replaces** the body with the cleaned data. |
| `src/controllers/authController.js` | **register:** duplicate check (409), bcrypt hash (cost 10, about 100 ms), role hard-coded to `applicant`. **login:** the same 401 message for an unknown email and a wrong password, so login can't reveal who has an account. **Token:** contains only `{ id, role }`, because a JWT is signed but not encrypted and anyone holding it can read it. |
| `src/middleware/auth.js` | `verifyToken` reads `Authorization: Bearer <token>`, verifies the signature and expiry (algorithm pinned to HS256), and sets `req.user = { id, role }`. From here on, `req.user` is the **only** identity the server trusts. |
| `src/middleware/requireRole.js` | `requireRole('admin')` lets a request through only if the token's role matches. 401 means "we don't know who you are"; 403 means "we know, and you're not allowed". |
| `src/routes/auth.js` | `POST /register`, `POST /login` (public) and `GET /me` (token required). Express 5 sends errors from async handlers to `errorHandler` automatically, so the controllers have no try/catch. |
| `src/utils/httpError.js` | `httpError(409, 'msg')` creates an Error carrying a status for the error handler. |
| `scripts/seed.js` | Upserts the admin (from `ADMIN_EMAIL` / `ADMIN_PASSWORD`) and four courses. It is safe to run twice and is the **only** way to create an admin. |
| `tests/setupEnv.js`, `tests/helpers/db.js` | Point tests at the test database and wipe it between tests. The helper refuses to run unless the database name ends in `_test`. |

`errorHandler.js` also gained mappings: MongoDB duplicate key (`11000`) → 409;
Mongoose `ValidationError` / `CastError` → 400.

### Front end
| File | What it does and why |
|---|---|
| `core/auth.service.ts` | Stores the JWT and user in `localStorage` (so a reload keeps you logged in) and in signals (so the UI reacts). `isLoggedIn()` is a method, not a computed signal, so expiry is re-checked on every call. The expiry check is UX only. Trade-off: scripts on the page can read localStorage; httpOnly cookies would be safer in production. |
| `core/auth.interceptor.ts` | Adds `Bearer <token>` to requests for **our** API only. On a 401 it logs out and sends you to `/login`, except for the login request itself, where a 401 just means a wrong password. |
| `core/auth.guards.ts` | `roleGuard('applicant' | 'admin')`: not logged in → `/login`; wrong role → your own home page. `guestGuard` keeps logged-in users off the login and register pages. These only control which **pages** open. |
| `shared/api-error.ts` | Turns any failed HTTP call into one readable sentence; status 0 means the back end isn't running. |
| `pages/login`, `pages/register` | Reactive forms with the same rules as the server, plus loading and error states. After login, the redirect uses the role **the server returned**. "Forgot password?" explains that email reset is out of scope. |
| `app.ts`, `app.html` | The shell: a top bar with name, role and Logout, and the router outlet below it. |

---

## Phase 2 — Courses and Draft applications

**Goal:** an applicant picks a course, enters their qualifying percentage,
saves a **Draft**, edits it, and sees its status on the dashboard.

### Back end
| File | What it does and why |
|---|---|
| `src/models/Application.js` | D2. `applicant` is `unique`, so the **database** enforces "one application per applicant" even under a race. `status` defaults to Draft and `applicationDate` to now. `entranceScore` and `meritScore` start as `null` and are filled by the admin and the merit calculation in later phases. |
| `src/validators/applicationSchemas.js` | `.strict()` **rejects** unknown keys with 400 instead of dropping them, so an applicant sending `status`, `entranceScore`, `meritScore` or `applicant` gets a clear error. (Register drops a forged `role` silently instead, because the spec says "ignored".) The course id must be a valid ObjectId, and `qualifyingPercent` must be a number from 0 to 100; the string `"80"` is rejected. An empty update is rejected. |
| `src/controllers/courseController.js` | Lists courses sorted by name. |
| `src/controllers/applicationController.js` | **create:** 409 if you already have one; 400 if the course doesn't exist; `applicant` comes from `req.user.id`, and status and date come from schema defaults. **getMine:** 404 means "not started yet". **updateMine:** one atomic `findOneAndUpdate({ applicant: me, status: 'Draft' })`, so "is it still a Draft?" and "save" can't be split by a submit arriving in between. If nothing matched, it works out whether that's a 404 (no application) or a 409 (past Draft). |
| `src/routes/courses.js` | `GET /api/courses` for any logged-in user. |
| `src/routes/applications.js` | `router.use(verifyToken, requireRole('applicant'))` guards every route in the file at once. There is **no `:id` route**: applicants can only ever reach `/me`. |
| `tests/helpers/users.js` | Creates a user directly in the database and signs a token for them, so tests can act as "applicant A", "applicant B" or "admin" quickly. |

### Front end
| File | What it does and why |
|---|---|
| `core/models.ts` | TypeScript shapes for Course and Application. They help at compile time only and validate nothing at runtime. `ApplicationInput` has no `status`, because the server owns it. |
| `core/application.service.ts` | All course and application HTTP calls in one place. `getMine()` turns a 404 into `null`, because "not started" is a normal state, not an error. |
| `shared/status-badge.ts` | A coloured pill per status (Draft grey, Submitted/Under Review blue, Approved green, Rejected red, Waitlisted amber). Shared with the admin page later. |
| `pages/applicant-dashboard/*` | Loads courses and the application in parallel (`forkJoin`). With no application, the form is open in **create** mode. With a Draft, the form is read-only until **Edit Application**. Past Draft, it stays read-only. **Track Status** re-fetches from the server. The checklist is computed from the application; "Documents uploaded" stays unticked until Phase 3. Upload and Submit are disabled placeholders until Phases 3 and 4. |

---

## Test index

`npm test` in `backend/` runs 45 tests in 3 suites.

| ID | What it proves |
|---|---|
| HEALTH-01..03 | Health reports database state; unknown route → 404 JSON; malformed JSON → 400 |
| AUTH-01 | Register returns 201, a token and an applicant |
| AUTH-02 | `passwordHash` and the password never appear in responses |
| AUTH-03 | The stored password is a bcrypt hash |
| AUTH-04 | A duplicate email (any letter case) → 409 |
| AUTH-05 | Invalid email, short password, missing name or bad phone → 400 with `field` |
| AUTH-06 | Login JWT contains `id` and `role` |
| AUTH-07 | Wrong password and unknown email give the same 401 |
| AUTH-08..11 | `/me` with a valid token; no token, a forged-secret token and an expired token → 401 |
| AUTH-12..13 | `requireRole('admin')`: applicant → 403, admin → 200 |
| SEC-03 | A forged `role: "admin"` in the register body is ignored |
| COURSE-01..02 | Courses need login and are sorted by name for any role |
| APP-01 | Create makes a Draft owned by the caller |
| APP-02 | A second application → 409 |
| APP-03..04 | qualifyingPercent above 100, below 0, a string or missing → 400; exactly 0 and 100 are accepted |
| APP-05..06 | A non-existent or malformed course id → 400 |
| APP-07..08 | GET /me → 404 before creating; returns the course populated |
| APP-09..11 | Draft editable; empty update → 400; update before creating → 404 |
| APP-12 | A non-Draft application cannot be edited (409) and stays unchanged |
| SEC-01 | Applicant B can neither read nor change applicant A's application |
| SEC-05 | `status`, `entranceScore` and `meritScore` can't be set on create, and `status` can't be set on update |
| SEC-06 | An applicant can't create an application for someone else |
| SEC-07 | An admin gets 403 on applicant-only routes |

---

## Problems hit and how they were solved

1. **MongoDB 8.0 won't start on Linux kernel 6.19+** (MongoDB issue
   SERVER-121912). Fixed by pinning `mongo:8.2` in `docker-compose.yml`.
2. **Every database connection failed inside Jest** with *"Missing required
   sub-document 'driver' in the client metadata document"*. MongoDB driver
   7.7 loads Node's `os` module with a dynamic `import()`. Jest's sandbox
   rejects dynamic imports unless Node runs with `--experimental-vm-modules`,
   so the driver sent an empty handshake. Fixed by running Jest through
   `node --experimental-vm-modules` in the `test` script.
3. **Mongoose 9 deprecated the `new: true` option.** `findOneAndUpdate` now
   uses `returnDocument: 'after'`.
