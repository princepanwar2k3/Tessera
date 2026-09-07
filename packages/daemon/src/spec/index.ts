/**
 * Barrel export — the ONLY import path the rest of packages/daemon may use
 * for spec-derived types and logic. Do not import from ./types.ts or
 * ./boundary.ts etc. directly outside this directory.
 *
 * When packages/protocol / packages/core exist, swap this file's contents
 * for `export * from "@tessera/protocol"` (retaining local files only where
 * daemon-specific orchestration diverges from what core provides).
 */
export * from "./types.js";
export * from "./boundary.js";
export * from "./leadTime.js";
