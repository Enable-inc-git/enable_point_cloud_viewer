// scripts/copy-index.js
// Purpose: During Netlify deploy, copy the single shared index.html + libs (+ logo, if present)
// into /clients/<CLIENT>/ so each client site serves the same viewer but only their own content.
// This version has **no default project**. Only URLs like /p/<project> will render the viewer.
//
// Required Netlify environment variable per site:
//   CLIENT=Test   ← the client folder name under /clients

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const CLIENT = process.env.CLIENT;

if (!CLIENT) {
  console.error("ERROR: Missing env var CLIENT (e.g., 'Test'). Set this in Netlify → Site settings → Build & deploy → Environment variables.");
  process.exit(1);
}

const repoRoot  = process.cwd();
const clientDir = path.join(repoRoot, "clients", CLIENT);

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function copyDir(src, dest) {
  if (!(await exists(src))) {
    console.error(`ERROR: Source folder not found: ${src}`);
    process.exit(1);
  }
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

(async () => {
  // Sanity checks
  const idxSrc  = path.join(repoRoot, "index.html");
  const libsSrc = path.join(repoRoot, "libs");
  if (!(await exists(clientDir))) {
    console.error(`ERROR: Client folder does not exist: ${clientDir}`);
    console.error("Create it like: clients/<CLIENT>/pointclouds/<project>/...");
    process.exit(1);
  }
  if (!(await exists(idxSrc))) {
    console.error(`ERROR: index.html not found at repo root: ${idxSrc}`);
    process.exit(1);
  }
  if (!(await exists(libsSrc))) {
    console.error(`ERROR: libs/ not found at repo root: ${libsSrc}`);
    process.exit(1);
  }

  // 1) Copy shared index.html into the client folder
  const idxDst = path.join(clientDir, "index.html");
  await fsp.copyFile(idxSrc, idxDst);

  // 2) Copy shared libs/ into the client folder so ./libs/... paths work
  const libsDst = path.join(clientDir, "libs");
  await copyDir(libsSrc, libsDst);

  // 3) Copy logo if present (optional)
  const logoSrc = path.join(repoRoot, "EnableLogo.png");
  if (await exists(logoSrc)) {
    const logoDst = path.join(clientDir, "EnableLogo.png");
    await fsp.copyFile(logoSrc, logoDst);
  }

  // 4) Write _redirects so **only** /p/<project> routes resolve to index.html
  //    (No default redirect from "/")
  const redirects = "/p/*   /index.html   200\n";
  await fsp.writeFile(path.join(clientDir, "_redirects"), redirects, "utf8");

  console.log("Prepared client folder:", clientDir);
  console.log("Redirects written (no default project):");
  console.log(redirects);
})();
