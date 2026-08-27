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
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/conterra/partialslab/pointclouds/scan"
  }
};
