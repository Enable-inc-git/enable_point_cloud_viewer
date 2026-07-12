// BDA project registry.
// Jarvis is still served from the git repo (relative path). St. Joseph's Hamilton
// is served from the Cloudflare R2 bucket 'enable-pointclouds' (absolute URL) — the
// viewer loads <folder>/cloud.js and derives <folder>/../../stations from it.
window.PROJECTS = {
  "jarvis": {
    name: "222 Jarvis Elevator 4",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/jarvis/pointclouds/scan"
  },
  "stjoseph": {
    name: "St. Joseph's Hamilton",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/bda/stjoseph/pointclouds/scan"
  }
};
