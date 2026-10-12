#!/usr/bin/env node
// `sim` - the System Design Simulator command line (sim cli).
// Runs the TypeScript entry in-process through tsx, so no build step is needed.
// Install it on your PATH from a checkout with `npm link`; `npm run sim -- <args>`
// is the same command without linking.
// Same hooks as `node --import tsx` (ESM and CommonJS TypeScript loaders).
await import('tsx')
await import(new URL('../src/cli/index.ts', import.meta.url).href)
