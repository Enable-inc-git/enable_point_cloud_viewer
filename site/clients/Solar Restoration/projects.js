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
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/solar/80stclaire/pointclouds/stairwell",
    // Load the guard/handrail GLB on startup instead of leaving it as a "Load" row.
    autoLoadModels: true,
    // Pull the initial crop box in to the model's extents: the four side faces a
    // further 125 mm PAST the model (negative margin) to shave the shaft walls off,
    // top and bottom flush. Trims the 11 m shaft to just the stair run. Cropping
    // inside the model is safe because models are not clipped by crop boxes.
    clipToModel: { sides: -0.125, z: 0 },
    // ...which requires the model NOT to be trimmed by the crop boxes, since the
    // box now cuts inside the model's own extents. Opt-out is per project: every
    // other project keeps the legacy clip-to-box default.
    clipModelsToBoxes: false
  }
};
