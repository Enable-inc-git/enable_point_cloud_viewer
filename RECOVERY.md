# RECOVERY — how to rebuild this system from scratch

**Purpose:** if the primary laptop is lost, stolen, or wiped, this file is the
single entry point for getting back in business on a new machine. It explains
where every piece lives, what is *not* in git, and how the day-to-day workflow
runs.

**Written 2026-07-31.** Keep it current — it is only useful if it is true.

---

## 0. Fresh Claude Code instance: start here

```bash
git clone https://github.com/Enable-inc-git/enable_point_cloud_viewer.git
cd enable_point_cloud_viewer
```

Then read, in this order:

| File | What it gives you |
|---|---|
| `RECOVERY.md` (this file) | Environment, accounts, workflow, what's missing |
| `AI_HANDOFF_BRIEF.txt` | Chronological log of every feature batch, newest first |
| `PUBLISHED_PROJECT_URLS.txt` | Every live client/project URL (auto-generated) |
| `docs/onboarding.md` | Granting client access; adding a new client/project |
| `MEMORY.md` + `memory/` (see §5) | The deep per-topic engineering notes |

The repo also carries `.claude/settings.json`, which installs a **SessionStart
hook** that re-injects the core operating rules into every new Claude Code
session automatically. Clone the repo and that behaviour comes back for free.

---

## 1. What this system actually is

A **static** Potree-based 3D point-cloud viewer for structural/civil engineering
work. No application server. Three moving parts:

1. **Code** — this GitHub repo. Plain HTML/CSS/JS, no build step for the viewers.
2. **Data** — point-cloud octrees, panoramas and GLB models on **Cloudflare R2**,
   served over HTTPS directly to the browser.
3. **Hosting** — **Netlify**, auto-deploying `main` to `https://viewer.enable-inc.com`.

Each client gets a folder `site/clients/<Client>/` containing a complete viewer.
The **only** per-client configuration is `projects.js`; every other file is
generic and kept byte-identical across clients (see §6).

---

## 2. Where everything lives

| Component | Location | In git? | How to regain |
|---|---|---|---|
| Viewer source | `site/clients/<Client>/` | ✅ | `git clone` |
| Shared Potree build | `site/clients/libs/potree/potree.js` | ✅ | `git clone` — **edits here hit all viewers** |
| Firebase auth (dormant) | `site/clients/libs/firebase/` | ✅ | `git clone` |
| Netlify build recipe | `netlify.toml` | ✅ | `git clone` |
| Firestore rules | `firebase/firestore.rules` | ✅ | Paste into Firebase console when changed |
| Project → data mapping | `site/clients/<Client>/projects.js` | ✅ | `git clone` |
| **Engineering memory** | `~/.claude/projects/C--enable-point-cloud-viewer/memory/` | ❌ | Google Drive backup — **see §5** |
| **R2 credentials** | repo-root `.r2creds.json` | ❌ gitignored | Re-mint in Cloudflare (§4) |
| Point clouds / panoramas / models | Cloudflare R2 bucket `enable-pointclouds` | ❌ | Cloudflare account |
| Raw scan sources (`.las`, `.e57`, `.scan`, `.ifc`) | `C:\enable_point_cloud_viewer_scans` + client folders | ❌ gitignored | Re-export from the scanner / client |
| PotreeConverter | `C:\PotreeTools\PotreeConverter_1.7_windows_x64` | ❌ | Re-download (§7) |
| IfcConvert | `C:\IfcTools\IfcConvert.exe` | ❌ | Re-download (§7) |

### Service endpoints

- **Live site:** `https://viewer.enable-inc.com`
- **Repo:** `https://github.com/Enable-inc-git/enable_point_cloud_viewer` (branch `main`) — **public**
- **R2 bucket:** `enable-pointclouds`
- **R2 public URL base:** `https://pub-3f436f87578a4223ae3a342484363f71.r2.dev`
- **Firebase project id:** `enable-point-cloud-viewer` (Spark/free; login is currently dormant)

URL format: `https://viewer.enable-inc.com/clients/<Client>/viewer.html?p=<projectId>`
(spaces in client folder names become `%20`).

---

## 3. ⚠ What is NOT in git — the real recovery risk

Cloning the repo gets you the code and nothing else. These five things die with
the laptop:

1. **The memory directory** — 58 topic files of hard-won engineering context
   (why things are built the way they are, gotchas, per-client history). Without
   it a new assistant can read the code but not the *reasoning*. **Backed up to
   Google Drive — see §5 for the folder and the restore steps.**
2. **`.r2creds.json`** — Cloudflare R2 Object Read & Write token. Deliberately
   gitignored. Re-mint it (§4); nothing is lost permanently.
3. **Local tool installs** — PotreeConverter 1.7 and IfcConvert. Freely
   re-downloadable (§7).
4. **Raw scan sources** — `.las` / `.e57` / `.scan` / `.ifc` are gitignored
   because they are huge. The *converted* octrees are safe on R2, so the live
   viewers keep working; you only lose the ability to **re-convert** a scan
   (e.g. to change density) without the original file. Keep an independent
   backup of `C:\enable_point_cloud_viewer_scans`.
5. **Uncommitted work in the working tree.** At the time of writing that
   includes WJ Properties' shelved temporal scan-compare feature. Anything not
   pushed is gone. Push early.

---

## 4. Accounts to regain access to

Do these first; everything else is downstream.

| Service | Why | Notes |
|---|---|---|
| **GitHub** (`Enable-inc-git` org) | Source of truth | Public repo — readable without auth, but you need write access to push |
| **Netlify** | Hosting + DNS for `viewer.enable-inc.com` | Auto-deploys `main`. Re-link the GitHub repo if the site is recreated |
| **Google account** (`kevin@enable-inc.com`) | Holds the memory backup (§5) | Install **Google Drive for Desktop** so the backup script can see the mount |
| **Cloudflare** | R2 bucket `enable-pointclouds` = all the data | Re-mint an **Object Read & Write** API token; write it to repo-root `.r2creds.json` (§7) |
| **Firebase** | Auth/Firestore (dormant, but wired) | Project `enable-point-cloud-viewer` |
| **Domain registrar** | `enable-inc.com` DNS | Only if Netlify's DNS entry needs re-pointing |

**Recreating `.r2creds.json`** — repo root, gitignored, exact key names:

```json
{
  "_comment": "Cloudflare R2 Object Read & Write token. NEVER commit.",
  "provider": "cloudflare-r2",
  "account_id": "...",
  "endpoint": "https://<account_id>.r2.cloudflarestorage.com",
  "bucket": "enable-pointclouds",
  "public_url": "https://pub-<hash>.r2.dev",
  "access_key_id": "...",
  "secret_access_key": "..."
}
```

Uploads use `boto3` with `region_name='auto'` against `endpoint`.

---

## 5. The memory system (read this twice)

Claude Code keeps a persistent, file-based memory for this project at:

```
~/.claude/projects/C--enable-point-cloud-viewer/memory/
```

(On this machine: `C:\Users\kpcou\.claude\projects\C--enable-point-cloud-viewer\memory\`.
The `C--enable-point-cloud-viewer` segment is derived from the project path, so
it changes if the repo is cloned somewhere else.)

**Structure:**

- `MEMORY.md` — the index. Auto-loaded into context at the start of every
  session, so it must stay under ~24 KB. One line per topic file.
- One `.md` file per fact/topic, with YAML frontmatter (`name`, `description`,
  `metadata.type` = `user` | `feedback` | `project` | `reference`). Files
  cross-link with `[[wiki-style]]` slugs.

**Why it matters:** the code says *what*; memory says *why*, plus every trap
already paid for — e.g. that `git apply` silently no-ops on `--relative`
patches, that a plane's `normal` sign is unstable so `basis.Z` is canonical,
that model scale must be judged from the viewer's own bounds log rather than an
offline GLB parse.

**It is NOT in this repo** — this repo is public, and the notes name clients,
sites and addresses. It is backed up to Google Drive instead.

### The backup — Google Drive

Folder: **"Enable Viewer — Claude Code Memory Backup"** in the My Drive of
`kevin@enable-inc.com`.

| Item | What it is |
|---|---|
| `memory/` | All 58 `.md` files, plain and readable — the primary copy |
| `MEMORY.md (readable index)` | The index alone, for skimming from a phone |
| `memory-backup-<date>.tar.gz` | The same files as one archive |
| `RESTORE — read me first.md` | Restore instructions |
| `RECOVERY.md (copy from repo).md` | Copy of this file, readable before you can clone |

**To restore:** copy the folder's `memory/` contents into
`~/.claude/projects/<slug>/memory/` on the new machine. Start Claude Code in the
repo once first so it creates the correctly-named `<slug>` directory.

**To refresh** (do this after any notable batch of work):

```bash
python scripts/backup_memory.py           # copy + archive + verify
python scripts/backup_memory.py --check   # verify only, change nothing
```

The script works because **Google Drive for Desktop** mounts the account as a
normal drive (`H:` on the original machine), so the backup is a plain file copy
— no upload step, no transcoding, files land byte-exact and every one is
SHA-256 verified. It auto-detects both the memory directory (the slug varies by
machine) and the Drive mount; `--dest` overrides the destination if Drive for
Desktop isn't available.

> **Gotcha:** don't write archives *directly* onto the Drive-mounted
> filesystem and then `stat()` them — Drive buffers the write and you'll read a
> half-flushed file (a tar.gz that looked like an empty 39-byte file). The
> script builds the archive in a temp dir, reads it back to confirm the entry
> count, then copies it across.

The memory files contain no credentials — only *references* to where secrets
live (field names, file paths), plus the Firebase web API key, which is public
by design.

---

## 6. The daily workflow — 7 viewers kept in sync

**The seven live viewers:** `HRI`, `BDA`, `MurrayFranks`, `Pomerleau`,
`Solar Restoration`, `WJ Properties`, `demo`.
(`Dev`, `Dev2`, `PlaneTest` are stale sandboxes — exclude them.)

Each viewer is five files:

```
site/clients/<Client>/
  viewer.html   # the whole app; ALL custom JS inline in one <script> IIFE
  chrome.js     # top toolbar + right context panel + touch input
  chrome.css
  icons.js
  custom.css    # Enable green #3EAD4A
  projects.js   # THE ONLY per-client config
```

`viewer.html` and `chrome.js` are **generic** — they are byte-identical across
all seven except for a single build-tag line (and three extra blocks in `demo`
for its clean `/demo1` slug and `clipTopTrimZ`).

### The loop

1. **Pick one dev viewer** and make the change there only. (Which one rotates —
   check the newest entry in `AI_HANDOFF_BRIEF.txt`.)
2. **Eyeball it locally:**
   ```bash
   cd site && python -m http.server 8080
   # http://localhost:8080/clients/<Client>/viewer.html?p=<id>
   ```
   Hard-refresh (Ctrl+Shift+R) — caching is aggressive.
   For phone/tablet testing, use the machine's LAN IP instead of `localhost`
   and open port 8080 in the firewall.
3. **Only after the user approves**, propagate to the other six.
4. **Bump the build tag** in all seven (see below).
5. **Commit + push to `main`.** Netlify deploys automatically.
6. **Update `AI_HANDOFF_BRIEF.txt` and the memory topic file + `MEMORY.md`.**

### Propagating — the exact recipe

Generate patches relative to the dev client, then apply with `--directory`:

```bash
git diff --relative=site/clients/<Dev> -- site/clients/<Dev>/viewer.html > /tmp/viewer.patch
git diff --relative=site/clients/<Dev> -- site/clients/<Dev>/chrome.js  > /tmp/chrome.patch

for c in HRI BDA MurrayFranks Pomerleau "Solar Restoration" "WJ Properties" demo; do
  git apply --directory="site/clients/$c/" /tmp/viewer.patch
  git apply --directory="site/clients/$c/" /tmp/chrome.patch
done
```

> **TRAP — verify, don't trust the exit code.** `git apply` resolves patch paths
> against the **repo root**, not your shell's cwd. Running it from inside
> `site/clients/HRI/` prints `Skipped patch 'viewer.html'.` and **exits 0** — it
> silently does nothing. `--check` "passes" for the same reason. Always confirm
> with a grep for a string you just added:
> ```bash
> for c in HRI BDA ...; do grep -c 'someNewFunctionName' "site/clients/$c/viewer.html"; done
> ```

Patch-based propagation (rather than copying files) is what preserves each
client's build tag and `demo`'s three extra blocks. It also lets a client with
unrelated uncommitted work receive the change without disturbing it.

### Build tag

One line near the top of each `viewer.html`:

```js
try { console.info('[Enable] <Client> build <YYYY-MM-DD[letter]> — <summary>'); } catch (e) {}
```

The client name differs per file, so the tag line **cannot** be part of the
shared patch — set it with a per-client search/replace afterwards.

> **TRAP:** it is a single-quoted JS string. An apostrophe in the summary
> (`the dim's axis`) breaks the entire inline script in all seven files at once.

### Verifying `viewer.html` before committing

There is no build step, so nothing catches a syntax error. Extract the inline
script and check it:

```bash
python - "site/clients/BDA/viewer.html" <<'EOF'
import re,subprocess,os,sys,tempfile
src=open(sys.argv[1],encoding='utf-8').read()
b=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', src, re.S)[0]
p=os.path.join(tempfile.gettempdir(),'chk.js'); open(p,'w',encoding='utf-8').write(b)
r=subprocess.run(['node','--check',p],capture_output=True,text=True)
print('OK' if r.returncode==0 else r.stderr[:300])
EOF
```

And confirm the viewers are still in sync (expect only the tag line to differ):

```bash
diff <(tr -d '\r' < site/clients/BDA/viewer.html) \
     <(tr -d '\r' < site/clients/HRI/viewer.html) | grep -c '^[<>]'   # → 2
```

### Committing when one client has unrelated uncommitted work

To stage *only* the propagated change for such a client, build the intended blob
and write it straight to the index, leaving the working tree untouched:

```bash
git show 'HEAD:site/clients/<C>/viewer.html' > /tmp/x/viewer.html
(cd /tmp/x && git apply /tmp/viewer.patch)          # + set the build tag
BLOB=$(git hash-object -w /tmp/x/viewer.html)
git update-index --cacheinfo "100644,$BLOB,site/clients/<C>/viewer.html"
```

---

## 7. Data pipeline — scan to live

Prerequisites: **Python 3.13**, **Node 22**, plus:

- **PotreeConverter 1.7** — `C:\PotreeTools\PotreeConverter_1.7_windows_x64`.
  Version **2.1 is broken** for this workflow; use 1.7. Run it from PowerShell.
- **IfcConvert** — `C:\IfcTools\IfcConvert.exe`, for Tekla IFC → GLB
  (outputs metres, Y-up; the viewer rotates +90° about X to reach Z-up).
- `boto3` for R2 uploads.

Steps:

1. Convert the scan → `cloud.js` + `data/` octree.
2. Upload the octree to R2 under `<client>/<project>/pointclouds/<scan>/`.
   Panoramas go to `stations/`, models to `models/` (with a `models.json`
   manifest — required, or the Models panel stays empty).
3. Register it in `site/clients/<Client>/projects.js`, where `folder` is the
   **absolute r2.dev URL**.
4. Commit + push. Data itself never enters git — `.gitignore` has explicit
   per-project rules keeping octrees, panoramas and GLBs out.
5. `PUBLISHED_PROJECT_URLS.txt` regenerates itself from `projects.js` via the
   `PostToolUse` hook in `.claude/settings.json`; don't hand-edit it.

Big git pushes (when data *must* go through git) should be chunked to ~80 MB and
`git add`ed one file at a time to avoid Windows argument-length limits.

---

## 8. Deploy

Push to `main` → Netlify builds and publishes. `netlify.toml` copies the Potree
runtime and vendor libs into `site/clients/libs/` (every copy guarded with
`|| true`), publishes `site/`, and uses `site/_redirects` for clean slugs like
`/demo1`.

Netlify's secret scanner flags the public Firebase web API key; `netlify.toml`
already omits `firebase-config.js` from the scan. Note the TOML ordering trap:
`[build.environment]` must come **after** the `[build]` `command = """…"""`
block, or `command` gets reparented and the build breaks.

There is no staging environment. `main` is production.

---

## 9. Post-rebuild checklist

- [ ] Repo cloned; `git log` shows recent history
- [ ] Memory directory restored from Google Drive (§5); `python scripts/backup_memory.py --check` reports OK
- [ ] `.r2creds.json` recreated at repo root; a test `boto3` list of the bucket succeeds
- [ ] PotreeConverter 1.7 + IfcConvert installed
- [ ] `cd site && python -m http.server 8080` serves a viewer that loads its cloud from R2
- [ ] GitHub push access confirmed (`git push` on a trivial commit)
- [ ] Netlify linked to the repo; `viewer.enable-inc.com` resolves and serves the new commit
- [ ] Spot-check one project from `PUBLISHED_PROJECT_URLS.txt` in a browser
- [ ] Raw-scan archive restored from independent backup (if it existed)
