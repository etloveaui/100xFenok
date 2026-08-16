// Compatibility re-export. The canonical JSON serialization leaf lives inside
// the 100xfenok-next package boundary
// (100xfenok-next/scripts/cloud-data-plane) so Next/OpenNext output tracing
// never leaves the app root while the Worker and the node publisher share ONE
// implementation. Root-side scripts and tests keep importing this stable
// path; nothing here diverges.
export * from "../../100xfenok-next/scripts/cloud-data-plane/json-canonical.mjs";
