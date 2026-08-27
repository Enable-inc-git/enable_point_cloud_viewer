// Conterra project registry.
// Newer projects follow the per-site layout: octrees + panoramas + models are
// served from the Cloudflare R2 bucket 'enable-pointclouds' (NOT the git repo).
// The viewer loads <folder>/cloud.js, derives the stations folder as
// <folder>/../../stations and the models folder as <folder>/../../models, so
// each site gets its own R2 prefix.
window.PROJECTS = {
  "st_dennis_rear": {
    name: "7 St Dennis - Rear Entrance",
    folder: "7 St Dennis - Rear Entrance/pointclouds/rear_entrance"
  },
  "partialslab": {
    name: "Partial Slab Replacement",
    // Own R2 prefix (conterra/partialslab). 16.79M pts, no panoramas.
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/conterra/partialslab/pointclouds/scan",
    // Load models/ (shoring_model.glb) on startup instead of leaving it as an
    // on-demand "Load" row in the Models panel. Per-project opt-in — absent on
    // every other project, so nothing else changes.
    autoLoadModels: true,
    // Shave 900mm off the TOP of the initial locked crop box (metres):
    // box top 3.307 -> 2.407, bottom unchanged at -0.038.
    // Sized off the scan's Z histogram, not by eye. The top 300mm holds only
    // 0.51% of the points (sparse ceiling clutter) so a 0.3 trim was invisible;
    // the deck soffit is the dense 2.47-2.81m band. 0.9 cuts BELOW that band,
    // dropping the whole ceiling — 6,948,730 pts / 41.4% of the cloud — and
    // leaving the slab, columns and walls.
    clipTopTrimZ: 0.9,
    // Models start with their crop-box clipping toggle OFF, so the shoring model
    // draws whole instead of being sliced by the trimmed box. The ✂️ button in the
    // Models panel turns it on per model.
    clipModelsToBoxes: false
  }
};
