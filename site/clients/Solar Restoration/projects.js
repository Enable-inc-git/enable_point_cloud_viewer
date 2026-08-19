// Solar Restoration project registry.
// Octrees + panoramas + models are served from the Cloudflare R2 bucket
// 'enable-pointclouds' (NOT the git repo). The viewer loads <folder>/cloud.js,
// derives the stations folder as <folder>/../../stations and the models folder
// as <folder>/../../models, so each site gets its own R2 prefix.
window.PROJECTS = {
  "seneca": {
    name: "Seneca",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/solar/seneca/pointclouds/NO"
  },
  "80stclaire": {
    name: "80 St Claire Ave East, Toronto",
    // Own R2 prefix (solar/80stclaire). No station panoramas for this scan — the
    // stations.json fetch 404s harmlessly and the Panoramas toggle stays empty.
    // Tekla guard/handrail model at solar/80stclaire/models/ (same local frame as
    // the scan, so no modelOffset / modelScale needed).
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/solar/80stclaire/pointclouds/stairwell"
  }
};
