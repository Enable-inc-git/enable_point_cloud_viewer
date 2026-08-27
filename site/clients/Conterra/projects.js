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
    // Shave 600mm off the TOP of the initial locked crop box (metres).
    // The top 300mm of this scan holds only 0.51% of the points (sparse ceiling
    // clutter), so a 0.3 trim was invisible; 0.6 cuts into the deck soffit, the
    // dense 2.47-2.81m band that is 38% of the cloud. ~0.84 would clear it fully.
    clipTopTrimZ: 0.6,
    // Models start with their crop-box clipping toggle OFF, so the shoring model
    // draws whole instead of being sliced by the trimmed box. The ✂️ button in the
    // Models panel turns it on per model.
    clipModelsToBoxes: false
  }
};
