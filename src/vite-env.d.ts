// Ambient module declarations for Vite's virtual import suffixes, so that
// `src/` can own the WGSL `?raw` and CSS side-effect imports and still stay
// `tsc --noEmit`-clean. Before this, the production boot was exiled to `dev/`
// (outside tsconfig's include) purely to keep these untyped imports out of
// the type-checked surface — that exile is what Stage 0 removes.
//
// `*.wgsl?raw` -> the file's text, inlined by Vite as a string default export.
// `*.css`      -> a side-effect import (`import '@/ui/styles.css'`); no bindings.

declare module '*.wgsl?raw' {
  const src: string;
  export default src;
}

declare module '*.css';
