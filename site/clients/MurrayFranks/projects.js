// MurrayFranks project registry.
// Octree + panoramas + Tekla model are served from the Cloudflare R2 bucket
// 'enable-pointclouds' (NOT the git repo). The viewer loads <folder>/cloud.js,
// derives stations as <folder>/../../stations and models as <folder>/../models,
// so everything lives under murrayfranks/1531dupont/.
window.PROJECTS = {
  "dupont": {
    name: "1531 Dupont (Steel Canopy)",
    folder: "https://pub-3f436f87578a4223ae3a342484363f71.r2.dev/murrayfranks/1531dupont/pointclouds/scan"
  }
};
