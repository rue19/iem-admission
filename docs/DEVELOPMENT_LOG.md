# Development log

What each phase added, what every file does and **why** it is written the
way it is. Read this before the lab demo: you should be able to explain any
line of the code.

- [Phase 0 — Scaffolding](#phase-0--scaffolding)
- [Phase 1 — Accounts and login](#phase-1--accounts-and-login)
- [Phase 2 — Courses and Draft applications](#phase-2--courses-and-draft-applications)
- [Phase 3 — Document upload and validation](#phase-3--document-upload-and-validation)
- [Phase 4 — Submission, fees and the status workflow](#phase-4--submission-fees-and-the-status-workflow)
- [Phase 5 — Admin review](#phase-5--admin-review)
- [Phase 6 — Dashboard, eligibility and merit](#phase-6--dashboard-eligibility-and-merit)
- [Phase 7 — Security pass, browser check and final docs](#phase-7--security-pass-browser-check-and-final-docs)
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

## Phase 3 — Document upload and validation

**Goal:** an applicant uploads Identity Proof, Academic Certificate and an
optional Other document. The server accepts a file only if it passes Rule DU,
reports the first failing rule in the exact wording of the spec, and never
leaves a rejected or half-uploaded file on disk.

### How one upload flows
1. The browser sends `multipart/form-data` with `documentType` and `file`.
2. `verifyToken` and `requireRole('applicant')` run **before** multer, so an
   anonymous request can't make the server write anything to disk.
3. **multer** streams the file to `uploads/<random-uuid>.<ext>`, counting bytes
   as they arrive. At 5,242,881 bytes it stops, deletes the partial file and
   raises `LIMIT_FILE_SIZE`. If the client disconnects midway, multer deletes
   the partial file as well.
4. **The controller** checks that the application exists and is still a Draft,
   and that `documentType` is valid. It then reads the first 8 bytes of the
   saved file and asks `validateDocument` for a decision.
5. **Invalid:** the file is deleted, and the slot's record is set to `Invalid`
   with the reason (no `filePath`). The response is 400 with that reason.
   **Valid:** the record points at the new file. In both cases the slot's
   previous file is deleted only **after** the database points at the new state.

### Back end
| File | What it does and why |
|---|---|
| `src/services/documentValidation.js` | Rule DU as **pure functions**: values in, decisions out, with no Express, disk or database involved, so every branch is a one-line unit test. `MAX_BYTES = 5 × 1,048,576 = 5,242,880`. **`checkFileSize(bytes)`** takes the raw byte count only. A negative, NaN, Infinity, non-integer or non-number (`"5MB"`) value throws a 400 `Invalid file size`, so a nonsense size can never come out as "valid". 0 gives `EMPTY`, `> MAX_BYTES` (strictly greater) gives `TOO_LARGE`, and anything else gives `OK`. **`validateDocument({ extension, sizeBytes, isReadable })`** checks type, then size, then readability, and returns the **first** failure. **`hasValidSignature(header, ext)`** compares the magic bytes: `%PDF`, `FF D8 FF` or `89 50 4E 47`. The too-large message adds the exact size, e.g. `5,242,881 bytes (5.000001 MB)`, using 6 decimals so 1 byte over never shows as "5.00 MB". |
| `src/models/Document.js` | D4: metadata only (`originalName`, `storedFileName`, `filePath`, `mimeType`, `sizeBytes`, `validationStatus`, `validationMessage`). There are no file bytes in MongoDB: they would bloat every query and backup, and a MongoDB document is capped at 16 MB. A unique index on `{ application, documentType }` gives one current document per slot. `toJSON` hides `filePath` and `storedFileName`, because the browser never needs the server's disk layout. |
| `src/middleware/upload.js` | multer `diskStorage` with a **random UUID file name**. The user's name (e.g. `../../server.js`) is never used in a path, which prevents path traversal and name collisions. `limits.fileSize = MAX_BYTES` makes multer enforce the limit while reading. `uploadSingleFile` turns multer errors into our `{ error }` responses: `LIMIT_FILE_SIZE` becomes the too-large message, and a file in the wrong form field gets a clear 400. |
| `src/controllers/documentController.js` | **upload:** follows the flow above. The size comes from `req.file.size`, the bytes multer actually wrote, never a client-declared value. The MIME type is derived from the validated extension, not taken from the browser. A `try/catch` deletes the uploaded file on **any** error path. **list:** the caller's documents plus `requiredTypes`. |
| `src/config/env.js` | Gained `uploadDir` (from `UPLOAD_DIR`, resolved from `backend/`) and `backendRoot`. |
| `src/routes/applications.js` | Gained `POST` and `GET /me/documents`. |

**Design choice: why keep an "Invalid" record?** The spec says rejected files
must not stay in storage, yet the upload page must show per-file status and
submission must be blocked while a document is invalid. So the **file** is
deleted, but a small metadata record with `validationStatus: "Invalid"` and the
reason is kept. Uploading a corrected file replaces it.
**Exception:** a file over the limit is cut off by multer before the
controller runs, so no record is written. The slot keeps whatever it had
before, and the page shows the error.

### Front end
| File | What it does and why |
|---|---|
| `core/models.ts` | Gained `DocumentType` and `UploadedDocument`. The name avoids a clash with the browser's global `Document`. |
| `core/document.service.ts` | `list()` (404 becomes an empty list) and `upload()` with `FormData`. The Content-Type isn't set by hand because the browser adds the multipart boundary itself. `requiredDocumentsValid()` is shared by the dashboard and the upload page. |
| `pages/document-upload/*` | Three slots, each showing Not uploaded / Valid / Invalid, the server's message and the file name and size. A client-side hint warns early about a wrong type, an empty file or one over 5 MB, but the file is still sent, so the **server's** message is what counts. The Application Summary card shows the ID, course, percentage, status and document state. The Submit button stays disabled; its readiness text uses the same rule the server will enforce in Phase 4. |
| `pages/applicant-dashboard/*` | **Upload Documents** now links to `/documents`. The checklist item is ticked only when both required documents are Valid. |
| `app.routes.ts` | `/documents`, guarded for applicants. |

---

## Phase 4 — Submission, fees and the status workflow

**Goal:** the applicant submits only when everything required is in place. The
status moves Draft → Submitted, a Pending fee record is created, and the
applicant can mark it Paid with a mock payment. Every status change in the
system now goes through one state machine.

### How a submit flows
1. `POST /api/applications/me/submit`. No body is read; a `status` sent by the client is ignored.
2. The controller loads **my** application (by `req.user.id`), checks that its course still exists, and loads its documents.
3. `getSubmissionBlockers()` lists every problem. If there are any, the response is **400** `{ error: <first reason>, reasons: [...] }` and nothing changes.
4. `assertTransition('Draft', 'Submitted', 'applicant')` asks the state machine for permission.
5. One atomic update, `{ _id, status: 'Draft' } → { status: 'Submitted' }`, makes three simultaneous clicks succeed exactly once.
6. A `FeeRecord` is created (₹1,000, Pending). If that fails, the status is set back to Draft, because a standalone MongoDB has no multi-document transactions.
7. The response is `{ applicationId, application, feeRecord }`.

### Back end
| File | What it does and why |
|---|---|
| `src/services/statusWorkflow.js` | The state machine as **one map**: `from → { to: role allowed }`. Approved and Rejected map to `{}` (final). `canTransition(from, to)` says whether a move is in the map. `allowedNextStatuses(from, role)` returns what a role may do next, and the admin page will use it to enable only legal buttons. `assertTransition(from, to, role)` throws **409** for an illegal move or the wrong role. Anything not in the map, including "same status again", is illegal by default. That is safer than listing what is forbidden. |
| `src/services/submissionGate.js` | `getSubmissionBlockers({ application, courseExists, documents })` is a pure function that returns a list of reasons; an empty list means it may be submitted. The checks: status is Draft (if not, that is the **only** reason given); the course is selected and still exists; `qualifyingPercent` is a finite number from 0 to 100 (re-checked here even though the schema validates it, in case bad data reached the database); Identity Proof and Academic Certificate both exist and are **Valid**. The reason for an invalid document includes the upload's own message. |
| `src/models/FeeRecord.js` | D5. `application` is **unique** (one fee per application). It has `amount`, `feeStatus` (Pending/Paid), `createdDate`, `paidDate` and `transactionRef` (the mock receipt). |
| `src/config/constants.js` | Gained `FEE_STATUS` and `APPLICATION_FEE_AMOUNT` (1000). |
| `src/controllers/applicationController.js` | Gained `submitMyApplication`, following the flow above. |
| `src/controllers/feeController.js` | The fee is found through **my** application, so no id ever comes from the client. `payMyFee` is one atomic update, `{ feeStatus: 'Pending' } → Paid + paidDate + MOCK-<12 hex>`; paying twice is a 409. Nothing is read from the body, so a client can't choose the amount or the status. |
| `src/routes/fees.js` | `GET /api/fees/me` and `POST /api/fees/me/pay`, applicants only. |

**Design choices**
- **Not Draft gives 400, not 409, on submit.** Section 8.2 of the spec says a
  failed submit returns 400, and that covers "already submitted". The 409 from
  `assertTransition` is still used for admin status changes in Phase 5.
- **An invalid "Other" document doesn't block submission.** The spec gates on
  the *required* documents only. Other is optional.
- **Paying doesn't change the application status.** The fee is a separate
  record (D5). It feeds eligibility in Phase 6: Eligible requires fee Paid.

### Front end
| File | What it does and why |
|---|---|
| `core/models.ts` | Gained `FeeRecord` and `SubmitResult`. |
| `core/application.service.ts` | Gained `submit()`, which sends an empty body. |
| `core/fee.service.ts` | `getMine()` (404 becomes `null`) and `pay()`, which sends no amount or card details. |
| `shared/api-error.ts` | Gained `apiErrorReasons()`, which returns the submit endpoint's full list of reasons. |
| `pages/document-upload/*` | **Submit Application** works now. It is enabled only when the server's rule would pass, shows every reason if the server still refuses, and shows the Application ID on success. |
| `pages/applicant-dashboard/*` | The **Submit Application** quick action works too. A new **Application fee** card shows the amount, the status and **Pay fee (mock)**, and once paid, the date and reference. **Track Status** also refreshes the fee. |

---

## Phase 5 — Admin review

**Goal:** an administrator finds applications, reviews one in full (details,
documents, fee), records the entrance score and moves the status forward,
but only along the workflow. The applicant then sees the new status.

### How an admin decision flows
1. The page has already loaded `GET /api/admin/applications/:id`, which
   includes `allowedNextStatuses` worked out by the server's workflow map. Only
   those buttons are enabled.
2. Clicking **Approve** sends `PATCH /:id/status { status: "Approved" }`.
3. `verifyToken` + `requireRole('admin')` run, then `validate(statusBodySchema)`: the status must be one of the six names and no extra fields are allowed.
4. The controller loads the current status and calls `assertTransition(current, "Approved", "admin")`, which throws 409 if the move is illegal.
5. One atomic update, `{ _id, status: current } → { status: "Approved" }`. If another admin changed it a moment earlier, nothing matches and the response is 409 "changed by someone else". The page then reloads the real state.
6. The response carries the updated application and its new `allowedNextStatuses`, so the buttons update straight away.

### Back end
| File | What it does and why |
|---|---|
| `src/routes/admin.js` | `router.use(verifyToken, requireRole('admin'))` covers **every** `/api/admin/*` path, including ones that don't exist (an applicant gets 403, not 404, so the API reveals nothing). |
| `src/validators/adminSchemas.js` | **List query:** `status` must be a known status, `course` a valid ObjectId, `q` at most 100 characters; empty strings (the "All" dropdown options) mean no filter. **Status body:** `{ status }` only (strict). **Entrance score:** a number from 0 to 100, strict, so `"50"` and `null` are rejected. |
| `src/middleware/validate.js` | Gained `validate(schema, 'query')`. Express 5 makes `req.query` read-only, so the parsed result goes on `req.validatedQuery`. |
| `src/controllers/adminController.js` | **list:** builds a filter from status and course. For `q`, it finds users whose name or email contains the text (case-insensitive, with **regex characters escaped**, so `.*` is literal), and also matches the Application ID if `q` is a valid ObjectId. Results are populated with applicant name, email and contact plus the course, newest first, capped at 200. **detail:** application, documents, fee record and `allowedNextStatuses`. **updateStatus:** follows the flow above. **setEntranceScore:** one atomic update that applies only while the status is Submitted, Under Review or Waitlisted; otherwise 409 (no scoring a Draft, and no rewriting a score after the final decision). **downloadDocument:** streams a stored file with `res.sendFile(name, { root: uploadDir })`; `root` refuses any path outside the upload folder. It sends the type recorded at upload, `nosniff`, and an RFC 5987 `filename*` header. Rejected uploads have no file, so they return 404. |

**Design choices**
- **Admins can see Drafts.** This shows who has started but not submitted.
  The workflow still stops an admin from acting on a Draft (Draft → Submitted
  is the applicant's move only).
- **Entrance score is separate from the status.** Recording a score doesn't
  move the application. Phase 6 uses the score for the merit and eligibility
  calculations.
- **"Information verified" lives only in the browser.** It is the reviewer's
  checklist tick, and Approve stays disabled until it is ticked. It is UX, not
  a server rule, and it isn't stored.

### Front end
| File | What it does and why |
|---|---|
| `core/admin.service.ts` | `list(filters)` (only non-empty filters go in the query string), `get`, `updateStatus`, `setEntranceScore`, and `documentFile`. The file is fetched as a **Blob through HttpClient**, so the interceptor adds the token; a plain `<a href>` couldn't send the token. |
| `core/models.ts` | Gained `APPLICATION_STATUSES` for the filter dropdown. |
| `pages/admin-review/*` | Built to match the wireframe. **Filters:** search (ID, name or email), status and course, plus Clear. **Results list** with status badges. **Application information** card: ID, applicant, course, %, sports quota, date, entrance score, fee and reference. **Verification:** each document with Valid/Invalid and the server's reason, **View** for valid files, "Required documents valid" (computed) and an "Information verified" tick. **Entrance score:** shown only while it can be recorded. **Decision:** Approve / Reject enabled from `allowedNextStatuses`, plus **Update Status** with a dropdown of the other legal moves (Under Review, Waitlisted). After any change, both the detail and its row in the list update. **View** opens the new tab inside the click so pop-up blockers allow it, then fills it with the file. |


---

## Phase 6 — Dashboard, eligibility and merit

**Goal:** the admin sees counts by status and by course, worked out by
MongoDB in one aggregation. Each application gets a merit score and an
eligibility verdict from pure, fully tested functions.

### The aggregation, compared with SQL
```
SQL                                              MongoDB pipeline stage
-----------------------------------------------  --------------------------------------------
WHERE status = ? AND course = ?                  { $match: { status, course } }   (optional)
SELECT status, COUNT(*) ... GROUP BY status      { $group: { _id: '$status', count: { $sum: 1 } } }
JOIN courses c ON c._id = a.course               { $lookup: { from: 'courses', localField: '_id',
                                                              foreignField: '_id', as: 'course' } }
ORDER BY count DESC                              { $sort: { count: -1 } }
(several GROUP BY queries in one round trip)     { $facet: { total, byStatus, byCourse, byCourseAndStatus } }
```
`$facet` runs several sub-pipelines over the **same** matched documents, so one
database round trip returns the total, the by-status counts, the by-course
counts (with names) and the course × status table.

### Back end
| File | What it does and why |
|---|---|
| `src/services/eligibility.js` | **`checkEligibility({ qualifyingPercent, entranceScore, feeStatus })`** returns `{ eligible, message }`. The cut-offs are inclusive (exactly 60 and exactly 50 pass). When several conditions fail, one message is reported, in a fixed order: fee → score missing → entrance → qualifying. The spec's three messages are used word for word. "Entrance score not recorded" was added because the spec's table assumes a score exists, and a missing score shouldn't be reported as "below the cutoff". **`calculateMeritScore(q, e, sportsQuota)`** is the spec's pseudocode line by line, plus rounding to 2 decimals: `77.7*0.4 + 66.6*0.6` is `71.03999999999999` in binary floating point. |
| `src/controllers/adminController.js` | **dashboard:** the pipeline above. `$match` needs a real `ObjectId` for `course`, because aggregation doesn't cast strings the way `find()` does. A deleted course is labelled `(deleted course)`, so its applications aren't silently dropped from the counts. **setEntranceScore:** now also calculates `meritScore` and stores it in the same atomic update. That is safe because qualifying % and sports quota are frozen once an application is past Draft. **getApplication:** now includes `eligibility`, worked out on each request, never stored, because the fee can change separately. |
| `src/validators/adminSchemas.js` | `dashboardQuerySchema` takes `status` and `course` only, reusing the list's rules. |
| `src/routes/admin.js` | `GET /api/admin/dashboard`. |

### Front end
| File | What it does and why |
|---|---|
| `core/admin.service.ts` | `dashboard(filters)` and the `DashboardCounts` type. `ApplicationDetail` gained `eligibility`. A shared `toParams()` sends only non-empty filters. |
| `pages/admin-review/*` | A **Dashboard** block at the top: the total, plus "By status" and "By course" rows, each with a count and a bar showing its share of the total. It follows the status and course filters, and refreshes after every status change. The detail card now shows the **merit score** and the server's **eligibility** message (green if eligible, amber otherwise). Saving a score re-fetches the detail, so the new verdict appears, while keeping the reviewer's "Information verified" tick. |

---

## Phase 7 — Security pass, browser check and final docs

**Goal:** check the finished system against the test plan, attack it the way
a reviewer would, look at it in a real browser, and write the final
documentation.

### Security pass
Section 11 of the brief asked for five security properties. Earlier suites
already covered them (SEC-01..11). This phase added `tests/security.test.js`
(16 tests) for the attacks someone is likely to try by hand: NoSQL operator
injection, an oversized body, `__proto__` in JSON, an unsigned token, a token
with an edited role, malformed `Authorization` headers, a token for a deleted
account, `passwordHash` in admin responses, stack traces in 500s, and CORS
from another origin.

It found one real gap. `GET /api/admin/applications?status[$ne]=Draft` returned
200. That was not an injection: Express 5's default query parser never builds
`{ $ne: ... }` objects, so the key arrived as the literal string `status[$ne]`.
But zod silently dropped it, so the request returned every application,
unfiltered. The admin query schemas are now `.strict()`, so unknown
parameters get a 400 (SEC-21).

Two small hardening changes:
- `app.disable('x-powered-by')` stops the API announcing it runs Express (SEC-29).
- A JSON body over 100 KB now gets a clear `413 Request body is too large`
  instead of Express's default message (SEC-22).

`tests/e2e.test.js` (E2E-01) runs the brief's whole Definition of Done in one
test, using only the public API.

### Front-end tests
Four new specs (18 tests in total with `app.spec.ts`):
- `auth.guards.spec.ts`: logged-out, wrong role, expired token, `guestGuard`.
- `auth.interceptor.spec.ts`: the token goes to our API only; a 401 clears the
  session, except on the login form.
- `document.service.spec.ts`: the rule that enables Submit.
- `status-badge.spec.ts`: status → CSS class.

### Browser check
A Playwright script drove headless Chrome through the whole flow against the
real API and database. It registered an applicant, checked that `/admin`
redirects, created a Draft, uploaded an MP3 (rejected, Submit disabled),
replaced it, submitted, paid, then logged in as the admin, searched, moved to
Under Review, scored 78, checked "Eligible", approved, and confirmed the
applicant sees Approved. It saved the README screenshots
(`docs/screenshots/`). The script itself isn't in the repository because
it borrows Playwright from another project; the repository adds no extra
dependencies.

The run found two layout bugs, both fixed:
- The admin filter bar overflowed its card, because long course names made
  the `<select>` too wide. Fixed with `min-width: 0` on the grid items.
- The "Under Review" badge wrapped onto two lines. Fixed with `white-space: nowrap`.

It also confirmed that the only 4xx responses in a normal run are the
deliberate "not started yet" 404s and the deliberately rejected upload, and
that there were no JavaScript errors.

### Coverage
`npm run test:coverage`: 98.2% of statements, 93.1% of branches, 100% of
functions, 98.4% of lines.

### Documentation
| File | Contents |
|---|---|
| `README.md` | Rewritten as the complete reference: features, quick start, full setup, screenshot walkthrough, architecture and data-model diagrams (Mermaid, checked to render), every business rule, the full API with examples, the security table, testing with a traceability matrix, structure, design decisions, FAQ, limitations |
| `docs/DEMO_CHEATSHEET.md` | A five-minute demo order and the submit request through all six steps, with file:line references, plus likely questions and answers |
| `docs/WRITEUP_OUTLINE.md` | An outline and fact sheet for the 1–2 page write-up |

---

## Test index

`npm test` in `backend/` runs 319 tests in 12 suites. `npm test` in `frontend/` runs 18.

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
| SEC-01 | Applicant B can't read, change, submit or pay for applicant A's application, documents or fee |
| SEC-05 | `status`, `entranceScore` and `meritScore` can't be set on create, and `status` can't be set on update |
| SEC-06 | An applicant can't create an application for someone else |
| SEC-07 | An admin gets 403 on applicant-only routes (applications, documents, submit, fees) |
| SEC-08 | An unauthenticated upload is refused before anything is written to disk |
| SEC-09 | Submit and pay require a token |
| SEC-02 | **An applicant gets 403 on every `/api/admin/*` route**, including an unknown one |
| SEC-10 | No token → 401 on every admin route |
| SEC-11 | An applicant can't approve their own application through the admin route or their own update route |
| **Rule DU unit tests** | `tests/documentValidation.test.js` |
| DU-BV-00 | `MAX_BYTES` is exactly 5,242,880 |
| DU-BV-01..16 | File-size boundaries: −1 → invalid size; 0 → EMPTY; 1, 5,242,879 and 5,242,880 → OK; 5,242,881, 8,808,038, 2,147,483,648 and 4,294,967,296 → TOO_LARGE; NaN, ±Infinity, `"5MB"`, 1.5, undefined and null → invalid size (400), never Valid |
| DU-BV-17 | 4,294,967,296 is not wrapped round to EMPTY (no 32-bit overflow) |
| DU-P-01..07 | `validateDocument` paths: invalid type; valid type + oversized; valid type + unreadable; fully valid; empty; allowed extensions in any case; rejected extensions |
| DU-PR-01..05 | Precedence: MP3 + 8 MB + unreadable → "Invalid file type"; size before readability; empty before readability; type before a nonsense size; valid type + nonsense size → Invalid file size |
| DU-MSG-01..03 | The too-large message shows exact bytes and MB (1 byte over is not "5.00 MB") |
| DU-R-01..09 | Magic bytes: real PDF/JPG/JPEG/PNG pass; text renamed .pdf, PNG renamed .jpg, truncated, empty and unknown types fail |
| **Upload integration tests** | `tests/documents.test.js` |
| DOC-01 | A valid PDF is accepted, written to disk under its stored name, and only a reference is kept in MongoDB |
| DOC-02 | Valid PNG and JPG (upper-case extension) are accepted with the right MIME type |
| DOC-03 | Exactly 5,242,880 bytes is accepted |
| DOC-04 | `../../../etc/evil.pdf` is stored as `<uuid>.pdf` inside the upload folder |
| DOC-05 | MP3 → "Invalid file type…", nothing on disk |
| DOC-06 | 8.4 MB → "File too large…", removed from disk |
| DOC-07 | 5,242,881 bytes → too large, nothing on disk |
| DOC-08 | 0 bytes → "File is empty", nothing on disk |
| DOC-09 | Text renamed .pdf, or PNG renamed .jpg → "File is corrupted or unreadable" |
| DOC-10 | Precedence over HTTP: a zero-filled `.mp3` reports the type first |
| DOC-11..13 | Bad `documentType`, no file, or the wrong form field → 400, nothing left behind |
| DOC-14 | Re-uploading replaces the record and deletes the old file |
| DOC-15 | An invalid re-upload marks the slot Invalid and removes the old file |
| DOC-16 | Correcting an invalid upload makes the slot Valid again |
| DOC-17 | The list shows each slot's validity and the required types |
| DOC-18 | Uploading before an application exists → 404, nothing stored |
| DOC-19 | Uploading after Draft → 409, nothing stored |
| DOC-20 | A real upload **aborted midway** (connection dropped after 256 KB of a promised 2 MB): the partial file existed, then was removed; no record is stored |

| **Status workflow unit tests** | `tests/statusWorkflow.test.js` |
| WF-01 | All 7 legal transitions pass for the right role |
| WF-02..03 | The other 29 of the 36 from/to pairs (same status, backwards, leaving a final state, skipping a step) are rejected with 409 for both roles |
| WF-04 | Unknown statuses (`Selected`, lower-case `approved`, empty) are rejected |
| WF-05..06 | Wrong actor: an admin can't submit; an applicant can't make any admin move |
| WF-07..08 | `allowedNextStatuses` per role; Approved and Rejected are final |
| GATE-01..07 | Submission gate: complete Draft passes; an invalid optional Other doesn't block; not Draft is the only reason; missing course; % out of range, NaN, null or a string; each missing required doc listed; an invalid required doc includes its reason |
| **Submission and fee integration tests** | `tests/submission.test.js` |
| SUB-01 | No documents → 400 with both reasons; status stays Draft; no fee |
| SUB-02 | **Submit blocked while a document is invalid** |
| SUB-03 | Only one required document → blocked |
| SUB-04 | **Submit succeeds**: Submitted, a **Pending FeeRecord** (₹1,000), Application ID returned |
| SUB-05 | **Re-uploading after a correction enables submit** |
| SUB-06 | Submitting twice → 400; still one fee |
| SUB-07 | Three simultaneous submits → exactly one succeeds |
| SUB-08..09 | Course deleted, or stored % corrupted to 150 → blocked |
| SUB-10 | No application → 404 |
| SUB-11 | `status: "Approved"` in the submit body is ignored |
| SUB-12 | After submit, editing → 409 and re-uploading → 409 |
| FEE-01 | Paying before submitting → 404 |
| FEE-02 | `GET /fees/me` shows Pending after submit |
| FEE-03 | Pay → Paid, with `paidDate` and a `MOCK-…` reference |
| FEE-04 | Paying twice → 409 |
| FEE-05 | A client-sent `amount` and `feeStatus` are ignored |
| FEE-06 | Paying doesn't change the application status |

| **Admin integration tests** | `tests/admin.test.js` |
| ADM-01 | List with applicant (no passwordHash) and course populated |
| ADM-02..04 | Filter by status, by course, by both; empty filters mean all |
| ADM-05 | Unknown status filter or malformed course id → 400 |
| ADM-06 | Search by Application ID, by name (case-insensitive) and by email |
| ADM-07 | `q=.*` matches nothing (regex escaped) |
| ADM-08 | Detail includes documents (no file path), fee and `allowedNextStatuses` |
| ADM-09 | Unknown id → 404; malformed id → 400 |
| ADM-10..11 | Legal paths: Submitted → Under Review → Waitlisted → Approved; Under Review → Rejected |
| ADM-12 | **Illegal transitions** (skip a step, same status, backwards, out of a final state) → 409, unchanged |
| ADM-13 | An admin can't submit a Draft |
| ADM-14 | Unknown status, missing status or an extra field → 400 |
| ADM-15 | Two admins deciding at once → exactly one 200 and one 409 |
| ADM-16 | **The applicant sees the admin's decision** on `GET /applications/me` |
| ADM-20..23 | Entrance score: 0, 50, 72.5 and 100 are recorded; above 100, below 0, a string, null, missing or extra fields → 400; Draft, Approved or Rejected → 409; unknown → 404 |
| ADM-30..32 | Admin opens a valid file (type, `nosniff`, filename header, real bytes); a rejected upload → 404; an applicant → 403 |

| **Eligibility and merit unit tests** | `tests/eligibility.test.js` |
| ELIG-1..8 | **The full 8-row decision table** (Qualifying % ≥ 60 / Entrance ≥ 50 / Fee Paid). Only row 1 (all yes) is eligible; whenever the fee is unpaid the message is "fee payment pending"; otherwise entrance is reported before qualifying |
| ELIG-9 | The messages match the spec word for word |
| ELIG-10..14 | Boundaries: exactly 60 and 50 pass; 59.99 and 49.99 fail; no fee record counts as unpaid; a missing score is "incomplete" |
| MERIT-01 | (70, 40, false) → **0** (below the cutoff) |
| MERIT-02 | (70, 70, false) → **70.0** |
| MERIT-03 | (70, 70, true) → **75.0** |
| MERIT-04 | (95, 100, true) → **100** (103 capped) |
| MERIT-05..08 | No sports bonus below the cutoff; exactly 50 is scored (54); 100 is unchanged by the cap; float noise rounded (71.04) |
| **Dashboard integration tests** | `tests/dashboard.test.js` |
| DASH-01..03 | Counts by status, by course (names via `$lookup`), and by course × status |
| DASH-04..05 | Optional `$match` on status, and on course (ObjectId) |
| DASH-06 | No matches → zeros, not an error |
| DASH-07 | A deleted course is labelled, not dropped |
| DASH-08 | Invalid filters → 400 |
| MERIT-INT-01..06 | Recording an entrance score stores the right merit (the four spec cases); re-scoring recalculates; a refused score leaves the merit untouched |
| ELIG-INT-01..04 | The admin detail returns the right verdict: no fee, no score, eligible, below minimum |

| **Security pass** | `tests/security.test.js` |
| SEC-20 | `{ "$ne": null }` as email and password at login → 400, no token |
| SEC-21 | `status[$ne]=`, `course[$gt]=` and unknown parameters on the admin list and dashboard → 400 |
| SEC-22 | A JSON body over 100 KB → 413 |
| SEC-23 | `__proto__: { role: "admin" }` in a register body → still an applicant; no prototype pollution |
| SEC-24 | An unsigned (`alg: none`) admin token → 401 |
| SEC-25 | An applicant token with the role edited to admin → 401 (signature broken) |
| SEC-26 | Malformed `Authorization` headers → 401 |
| SEC-27 | A token for a deleted account → 401 on `/auth/me` |
| SEC-28 | `passwordHash` never appears in admin list or detail responses |
| SEC-29 | No `X-Powered-By` header |
| SEC-30 | An unexpected error → `{ "error": "Internal server error" }`, no internals |
| SEC-31 | CORS allows `localhost:4200`, not another origin |
| **End to end** | `tests/e2e.test.js` |
| E2E-01 | The Definition of Done through the API: register, login, create, upload ×2, submit (Pending fee), pay, admin search and review, illegal approve → 409, Under Review, score 78 → merit 84.8 and Eligible, approve, dashboard counts, applicant sees Approved |

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
4. **Expected MB values in tests must be calculated, not guessed.**
   8,808,038 bytes is 8.39999962 MB (8.4 after rounding), not 8.400002. The
   test was corrected; the code was right. Rounding to 6 decimals can never
   make an over-limit file look like it is within 5 MB, because the smallest
   over-limit size, 5,242,881 bytes, is 5.00000095 MB, which rounds to
   5.000001.
5. **Don't trust a floating-point example without running it.** The first
   draft claimed `70*0.4 + 70*0.6` gives `70.00000000000001`. Node actually
   gives exactly `70`. The comment and test now use a real case,
   `77.7*0.4 + 66.6*0.6 = 71.03999999999999`, which shows why the merit
   score is rounded.
6. **Ignored is not the same as rejected.** The security pass expected
   `?status[$ne]=Draft` to be refused. Instead it returned 200 with *every*
   application. That was harmless (no operator reached MongoDB), but it
   silently ignored input. The admin query schemas are now strict.
7. **The UI needed a real browser.** Builds and unit tests passed for six
   phases, but the first screenshots showed the admin filter bar overflowing
   its card. Only rendering the page caught it.
