declare const __VERSION__: string;
declare const __GIT_HASH__: string;

// Stylesheets are imported for their side effect only. Bun bundles them; the
// type checker (TS 6+ checks side-effect imports) just needs them to resolve.
declare module "*.css" {}

// Bun import attributes: `with { type: "file" }` yields the asset's path as a
// string (filesystem path in dev, embedded-asset path in the compiled binary).
declare module "*.wasm" {
  const path: string;
  export default path;
}

// `with { type: "text" }` yields the file contents as a string constant.
declare module "*.scm" {
  const text: string;
  export default text;
}
