// A gzipped GLB imported by a view is embedded by the build (esbuild's binary loader) and arrives as its bytes.
declare module '*.gz' {
  const bytes: Uint8Array;
  export default bytes;
}
