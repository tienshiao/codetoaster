// Loaded by a dynamic import in main.ts, the way the frontend loads mermaid.
// bundles.test.ts asserts it is inlined into the main bundle rather than split
// into a chunk that would be loaded relative to /_bundle/.
export const lazyMarker = "lazy-fixture-marker: inlined into the main bundle";
