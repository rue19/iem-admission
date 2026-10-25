# Write-up outline (1–2 pages)

An outline and fact sheet for the project write-up. The headings and notes are
here so nothing gets left out. The write-up itself should be in your own
words. If your course asks you to disclose AI assistance, say that this
project was built with Claude's help; the commit history records it.

Aim for roughly 700–900 words. Each section below has a suggested length,
what to cover, and facts from the project you can cite.

---

## 1. What I built (≈ 80 words)

Cover: the problem, the scope, and that it's a proof of concept.

Facts to use:
- A MEAN-stack admission system: register → apply → upload → submit → pay
  (mock) → admin review → decision → applicant sees the status.
- Two roles (applicant, admin), 19 API endpoints, 5 MongoDB collections
  (D1–D5 from the DFD), 5 Angular pages.
- Out of scope by design: real payments, email/SMS, seat allotment, deployment.

## 2. Architecture (≈ 150 words)

Cover: the three layers from the HLD and how one request crosses them.

Facts to use:
- Client: Angular 22 (standalone components, signals, reactive forms, an HTTP
  interceptor for the JWT, route guards).
- Application: Express 5 on Node. Routes → middleware (`verifyToken`,
  `requireRole`, `validate`, `upload`) → controllers → services.
- Data: MongoDB 8.2 through Mongoose 9. File bytes on disk, references in the
  database.
- The six-step submit flow (see `DEMO_CHEATSHEET.md`). It is a good concrete
  example to describe.
- Business rules live in four pure-function services, which is why they could
  be tested exhaustively.

## 3. Key design choices and why (≈ 250 words, the most important section)

Pick 3–4 and explain the reasoning, not only the choice:

| Choice | Reason | Evidence |
|---|---|---|
| All validation and access control on the server | Anything in the browser can be bypassed with curl | SEC-02, SEC-05, SEC-25 |
| `/me` routes instead of `/:id` for applicants | Can't request what you can't name; removes a class of access bugs | SEC-01 in four suites |
| Atomic conditional updates (`{ _id, status: 'Draft' }`) | Prevents double submits and two admins overwriting each other | SUB-07, ADM-15 |
| Status workflow as one map; everything else 409 | One place to read and change the rules; safe by default | 36 pairs tested (WF-01..03) |
| Magic-byte check on uploads | An extension alone is easy to fake | DOC-09 |
| Rejected uploads: delete the file, keep an "Invalid" record | Meets "nothing invalid in storage" while still showing why and blocking submit | DOC-15, SUB-02 |
| Merit stored, eligibility computed | Merit inputs are frozen after submit; the fee changes separately | MERIT-INT-*, ELIG-INT-* |
| One `users` collection with `role` | Applicant and Admin share every field | |

## 4. Testing (≈ 120 words)

Cover: how you know it works.

Facts to use:
- 319 back-end tests (Jest + supertest) in 12 suites, plus 18 Angular unit
  tests. Back-end coverage: 98% of statements, 100% of functions.
- Every item in the test plan maps to a named test (traceability table in the
  README).
- Boundary testing on file size: 5,242,880 accepted, 5,242,881 rejected; NaN,
  Infinity and "5MB" rejected as invalid sizes.
- One end-to-end test (E2E-01) runs the whole Definition of Done through the
  API, and a scripted browser run checked the UI.

## 5. Problems I ran into (≈ 120 words)

Pick two. Real ones from this project (details in `DEVELOPMENT_LOG.md`):
- MongoDB 8.0 wouldn't start on Linux kernel 6.19+; moved to 8.2.
- Jest couldn't connect to MongoDB until the test script added
  `--experimental-vm-modules` (the driver loads `os` with a dynamic import).
- Floating point: `77.7*0.4 + 66.6*0.6 = 71.03999999999999`, so merit is
  rounded to 2 decimals.
- A security test showed that unknown admin query parameters (like
  `status[$ne]`) were silently ignored; the query schema now rejects them.
- The first screenshots showed the admin filter bar overflowing its card;
  fixed with `min-width: 0` on the grid items.

## 6. What I would improve (≈ 100 words)

Pick 3–4, with one line each on why (full list in the README):
- Rate-limit login (brute force).
- httpOnly cookie instead of localStorage for the token (XSS).
- Audit trail of status changes (who changed what, and when).
- Real transactions on a replica set instead of the manual rollback.
- Object storage and virus scanning for uploads.
- Pagination on the admin list.

## 7. What I learned (≈ 60 words, optional)

Your own reflection: for example, what surprised you about MongoDB
aggregation compared with SQL, or why UI checks are not security.
