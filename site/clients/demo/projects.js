// Demo project registry (clients/demo/).
// Public-facing demos for FAQ / wider audience — names and folders are
// deliberately neutral so no client or site address is ever exposed in the
// viewer UI, the URL, or any served path. Add future demos as demo2, demo3, ...
window.PROJECTS = {
  "demo1": {
    name: "Demo1",
    folder: "demo1/pointclouds/cloud",
    // Trim the initial (locked) clip box down from the top by this many metres
    // in Z on first load, to hide a few errant uncleaned points near the ceiling.
    clipTopTrimZ: 1.0
  }
};
