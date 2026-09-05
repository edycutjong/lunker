/**
 * Metro configuration.
 *
 * WHY THIS FILE EXISTS
 *
 * The client imports the game's shared logic from the repo root:
 *
 *   app/src/state/GameContext.tsx   -> ../../../shared/content.js
 *   app/src/screens/MinigameScreen.tsx -> ../../../shared/tension.js
 *   app/src/screens/LakeMapScreen.tsx  -> ../../../shared/content.js
 *
 * That is deliberate — `shared/` is the single copy of the lake table, the fish
 * table and the reel-tension model, imported by BOTH the Worker and the app so
 * the two cannot disagree about what a rare Moonlight Koi weighs. Duplicating it
 * into `app/` would reintroduce exactly the drift the shared module prevents.
 *
 * But Metro's project root is `app/`, and by default it will not resolve a
 * module above that root. So every one of those imports failed to bundle, and
 * `expo prebuild` + `assembleRelease` died in
 * `:app:createBundleReleaseJsAndAssets`.
 *
 * WHY IT WAS NOT CAUGHT SOONER
 *
 * `tsc --noEmit` resolves those paths happily, because TypeScript walks the real
 * filesystem and the files genuinely are there. CI ran that typecheck and went
 * green. Metro is a different resolver with a different root, and nothing in the
 * pipeline had ever run it — the app had no build configuration and no artifact
 * had ever been produced. A green typecheck is not evidence that the app
 * bundles, and on this project it was actively misleading for weeks.
 *
 * `watchFolders` adds the repo root to the set of directories Metro will both
 * resolve from and watch for changes, which is what makes the imports above
 * work in the bundle and hot-reload during development.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Resolve and watch the repo root, so `shared/` is reachable from `app/`.
config.watchFolders = [repoRoot];

// With a watch folder above the project, be explicit about where packages come
// from. `app/node_modules` first so the app's own pinned React Native wins over
// anything the root tree happens to carry.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

module.exports = config;
