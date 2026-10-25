# Demo cheat-sheet

A script for the lab demo: what to show, in what order, and how to explain one
request (the submit flow) through all six steps of the MEAN request-response
loop, with the file and line where each step happens. Line numbers match the
`main` branch at the end of Phase 7.

## Before the demo

```bash
docker compose up -d                       # MongoDB
cd backend && npm run seed && npm run dev  # API on :3000
cd frontend && npm start                   # UI on :4200 (second terminal)
cd backend && npm test                     # optional: 319 passing (third terminal)
```

Have ready: one real PDF (any), one non-PDF (an MP3 or .txt), and the admin
login from `backend/.env`.

## Five-minute run order

1. **Register** a new applicant. Point out that the URL changes to `/dashboard`,
   and that typing `/admin` bounces back. That's the Angular guard, and it is UX
   only.
2. **Create the application**: course, percentage, Save. The badge says Draft.
3. **Upload Documents**: upload the MP3 into Academic Certificate. The server
   rejects it with "Invalid file type: only PDF, JPG and PNG are allowed", and
   Submit stays disabled.
4. Replace it with the PDF, then click **Submit**. *Walk through the six steps
   below for this click.*
5. **Pay fee (mock)** on the dashboard.
6. Log out, log in as **admin**. Show the dashboard counts, search for the
   applicant, open it, and show the documents (**View**).
7. Try nothing illegal in the UI (the buttons won't allow it). Instead, show the
   409 from the terminal:
   ```bash
   curl -s -X PATCH localhost:3000/api/admin/applications/<id>/status \
     -H "Authorization: Bearer <admin token>" -H 'Content-Type: application/json' \
     -d '{"status":"Approved"}'
   # {"error":"Illegal status change: Submitted → Approved"}
   ```
8. **Update Status** → Under Review. Enter an entrance score of 78; the merit
   score and "Eligible" appear. Tick Information verified, then **Approve**.
9. Log back in as the applicant: the badge says **Approved**.

## The submit request in six steps

### 1. Angular builds the request

- The button is in `frontend/src/app/pages/document-upload/document-upload.html:87`.
  It is disabled unless `canSubmit()` is true (`document-upload.ts:56`), which
  mirrors the server's rule. That is purely for UX.
- The click calls `submit()` (`document-upload.ts:107`), which calls
  `ApplicationService.submit()` (`frontend/src/app/core/application.service.ts:33`).
  That function POSTs an empty JSON body to `/api/applications/me/submit`.
- Before it leaves the browser, `authInterceptor`
  (`frontend/src/app/core/auth.interceptor.ts:16`) adds
  `Authorization: Bearer <token>`. The interceptor is registered in
  `app.config.ts:13`.

> Say: "The page sends no data at all, not even an application ID. The server
> already knows who I am from the token and finds my application itself."

### 2. HTTP/JSON reaches Express

- `backend/src/app.js:21`: CORS lets the request through because it comes
  from `CLIENT_ORIGIN` (`localhost:4200`).
- `app.js:25`: the JSON body parser (100 KB limit).
- `app.js:32`: anything under `/api/applications` goes to
  `routes/applications.js`.

### 3. Express middleware: who are you, and are you allowed?

- `backend/src/routes/applications.js:23`:
  `router.use(verifyToken, requireRole('applicant'))`.
- `verifyToken` (`middleware/auth.js:8`) splits off `Bearer`, then
  `jwt.verify` (line 18) checks the signature with `JWT_SECRET` and the expiry,
  with the algorithm pinned to HS256. On success it sets
  `req.user = { id, role }`; on failure it returns 401.
- `requireRole` (`middleware/requireRole.js:4`) returns 403 unless
  `req.user.role` is `applicant`.
- `routes/applications.js:35` hands over to `submitMyApplication`.

> Say: "Express runs middleware in order like a pipeline. If any step
> responds, the controller never runs."

### 4. Controller and Mongoose: the business rules

`backend/src/controllers/applicationController.js`, `submitMyApplication` at line 78:

| Line | What happens |
|---|---|
| 79 | `Application.findOne({ applicant: req.user.id })`. Always **my** application, from the token. |
| 84–87 | Loads in parallel: does the course still exist, and what documents do I have? |
| 88 | `getSubmissionBlockers(...)` (`services/submissionGate.js:8`), a pure function that lists every problem |
| 89 | If there are any problems → **400** `{ error, reasons }`, and nothing changes |
| 95 | `assertTransition('Draft', 'Submitted', 'applicant')` (`services/statusWorkflow.js:40`) checks the move against the workflow map at line 9 |
| 99 | `findOneAndUpdate({ _id, status: 'Draft' }, { status: 'Submitted' })`. The precondition is in the query, so it is atomic. |
| 112 | `FeeRecord.create({ amount: 1000 })`, Pending by default |
| 113–114 | If the fee record fails, the status is put back to Draft (no transactions on a standalone MongoDB) |
| 118 | Sends the response |

> Say: "Mongoose turns `findOneAndUpdate` into one MongoDB command. Because the
> condition `status: 'Draft'` is part of the update, two clicks at the same
> moment can't both succeed. Test SUB-07 fires three at once and checks
> exactly one wins."

### 5. MongoDB stores it

- The `applications` document gets `status: "Submitted"`. The allowed values
  come from `models/Application.js:16`, which takes them from
  `config/constants.js`.
- A new `feerecords` document is created. Its `application` field is
  **unique** (`models/FeeRecord.js:9`), so the database itself refuses a
  second fee for the same application.

### 6. JSON back to Angular, and the page updates

- Response: `200 { applicationId, application, feeRecord }`.
- `document-upload.ts:111–113` stores the application in a signal and shows
  the Application ID. Angular re-renders: the badge turns to **Submitted** and
  the upload slots disappear (documents are frozen after submit).

## Where each MEAN letter shows up

| Letter | In this request |
|---|---|
| **M**ongoDB | Stores the `applications` and `feerecords` documents (step 5) |
| **E**xpress | CORS, JSON parsing, the route, `verifyToken`, `requireRole`, the controller (steps 2–4) |
| **A**ngular | The page, `ApplicationService`, the interceptor, signals updating the view (steps 1 and 6) |
| **N**ode.js | Runs Express, Mongoose and the controller code on the server |

## Questions you may be asked

**"What stops me calling the API directly and approving my own application?"**
`/api/admin/*` requires the role `admin` inside a signed token. Changing the
role in the token breaks the signature (test SEC-25), and registration can't
create admins (SEC-03). The applicant update endpoint rejects a `status` field
(SEC-05).

**"Can I see someone else's application?"**
There's no route that takes an application ID from an applicant; everything is
`/me`, found through `req.user.id`. Test SEC-01 tries it in four suites.

**"Why not trust the file size the browser sends?"**
The browser can claim anything. multer counts the bytes as they arrive and
stops at 5,242,880 (`middleware/upload.js`), so the server only ever uses
`req.file.size`.

**"Why check magic bytes?"**
A text file renamed `marks.pdf` passes an extension check. Real PDFs start with
`%PDF`, JPEGs with `FF D8 FF` and PNGs with `89 50 4E 47`. Test DOC-09.

**"Where are the files stored? In MongoDB?"**
No. They go on disk in `backend/uploads/` under a random UUID name. MongoDB
keeps the metadata and the path only. Test DOC-01 checks that no file bytes are
stored.

**"How is the dashboard like SQL?"**
`$match` is WHERE, `$group` with `$sum: 1` is GROUP BY with COUNT(*),
`$lookup` is a JOIN, and `$facet` runs several GROUP BYs in one query. The
comment above `dashboard()` in `adminController.js` shows the SQL.

**"Why 409 and not 400 for an illegal status change?"**
The request is well-formed (400 would mean it isn't); it conflicts with the
application's current state. A failed submit is 400 because the brief
specifies that.

**"What happens if two admins click at the same time?"**
Both send a PATCH. The update matches `{ _id, status: <the status we
checked> }`, so only the first one matches; the second gets 409 and the page
reloads. Test ADM-15.

**"Why round the merit score?"**
Binary floating point: `77.7*0.4 + 66.6*0.6` is `71.03999999999999` in
JavaScript. Test MERIT-08.

**"What would you improve?"**
See "Known limitations" in the README: login rate limiting, token revocation,
httpOnly cookies, an audit trail of status changes, transactions on a replica
set, and object storage for files.
