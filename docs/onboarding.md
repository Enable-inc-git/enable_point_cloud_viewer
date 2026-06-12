# Onboarding — clients, projects, and access

This covers how to grant a client access to the viewer and how to spin up a new
project. Heavy point-cloud data stays on Netlify (unchanged); Firebase only gates
the viewer UI and stores per-user cloud sessions.

## Concepts

- **Client** (e.g. `BDA`, `Pomerleau`) — an organization. Has a Firestore doc
  `clients/{clientId}` with an access window (`grantUntil`, subscription fields)
  and a `members/` subcollection of authorized **email addresses**.
- **Member** — an email address allowed to use a client's viewers. Sign-in method
  (Google or email-link) doesn't matter; authorization is always by the verified
  email. A member can be the GC, a PM, or a subcontractor the GC asked you to add.
- **Cloud session** — a user's saved work, private to them, under
  `users/{uid}/projects/{projectId}/sessions`. Never shared/overwritten between
  users. Cross-party sharing is still done via the local "Save Session" file.

## Grant a user access (most common task)

Pick ONE of:

**A. Firebase console (no tooling):**
1. Firestore → `clients` → open (or create) the client doc, e.g. `BDA`.
   - If creating: set `name`, `grantUntil` (a Timestamp ~6 months out),
     `subscriptionStatus: "none"`, `currentPeriodEnd: null`.
2. In that doc, open the `members` subcollection → Add document.
   - **Document ID = the user's email, lowercased** (e.g. `someone@gc.com`).
   - Fields: `role: "client"`, `addedAt: <now>`.
3. Send the user their viewer URL (e.g.
   `https://viewer.enable-inc.com/clients/BDA/viewer.html?p=jarvis`). They sign in
   with Google or request an email link — access is immediate.

**B. Admin script (`scripts/admin/add-member.js`):**
```
node add-member.js BDA someone@gc.com            # existing client
node add-member.js BDA sub@trades.com --months 6 # creates client w/ 6-mo grant if new
```
See the file header for the one-time service-account setup.

To **revoke** access: delete the member doc. The user is locked out on next load.

**C. Whole-domain access (no per-person adds):** on the `clients/{clientId}` doc add
an **`allowedDomains`** field (type: array of strings), e.g. `["bda.com"]`. Anyone
who signs in with an email on that domain is admitted automatically. Explicit
`members` still work alongside it (use them for outside collaborators like a
subcontractor on `@gmail.com`). To revoke a whole domain, remove it from the array.

**Who has signed in:** every successful sign-in (explicit member or domain user)
is logged to `clients/{clientId}/signins/{uid}` with email, name, `lastSeenAt`, and
a `visits` counter. Browse it in the Firestore console (it's admin-read-only).

## New project (point cloud) for an existing client

1. Convert the scan with PotreeConverter 1.7 (`C:\PotreeTools`) → produces
   `cloud.js` + `data/` octree.
2. Drop the octree into the client's Netlify tree:
   `site/clients/<Client>/<Project>/pointclouds/<scan>/`.
3. Add the project to that client's `projects.js`:
   ```js
   window.PROJECTS = {
     "myproject": { name: "Friendly Name", folder: "<Project>/pointclouds/<scan>" }
   };
   ```
4. (Optional) Models: put `.glb` files + a `models.json` manifest in
   `<Project>/models/` — the viewer auto-lists them for one-click load.
5. (Optional) Stations/panoramas: `<Project>/stations/stations.json` + images.
6. (Optional, metadata mirror) Add a Firestore doc
   `clients/<Client>/projects/<myproject>` with `name` + `folder` (used later when
   the project registry moves to Firestore).
7. The viewer URL is `…/clients/<Client>/viewer.html?p=myproject`.

## New client (first project)

1. Create the client folder `site/clients/<Client>/` (clone an existing viewer,
   e.g. BDA, and rebrand `custom.css` / logo / title).
2. Ensure the viewer includes the Firebase block (the `<link>` + 5 `<script>` tags
   after `projects.js`) and gates on `EnableAuth.requireAccess('<Client>')` — copy
   the BDA wiring and change the client id string.
3. Add the first project (section above).
4. Grant the first member (section above) — this also creates the `clients/<Client>`
   doc with the 6-month grant.

## Notes

- Authorized domains: `viewer.enable-inc.com` and `localhost` must be listed under
  Firebase → Authentication → Settings → Authorized domains (one-time).
- Security rules live in `firebase/firestore.rules` — paste into the console
  (Firestore → Rules) whenever they change.
- The 6-month grant + monthly-subscription billing is designed-in but not yet
  activated; see the plan's "Timed access & subscriptions" section.
