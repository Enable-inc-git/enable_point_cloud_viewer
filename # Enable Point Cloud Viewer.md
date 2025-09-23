# Enable Point Cloud Viewer

A Potree-based static viewer for hosting point clouds.

## Folder structure
- `/` – site root with `index.html`
- `/pointclouds/...` – Potree-converted data (octree, metadata)
- `/assets` – logos, css, etc.

## Local dev
Open `index.html` directly or serve locally:
```bash
# any simple server
python -m http.server 8080
