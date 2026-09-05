/**
 * Release signing for the Android build, as a config plugin.
 *
 * WHY THIS IS A PLUGIN AND NOT AN EDIT TO build.gradle
 *
 * `android/` is generated (Expo CNG) and gitignored, and every
 * `expo prebuild --clean` deletes it. A signing config hand-edited into
 * `android/app/build.gradle` therefore survives exactly until the next prebuild,
 * and then the release build silently falls back to the DEBUG keystore — which
 * still produces a perfectly valid-looking APK. Google Play and the Samsung
 * Galaxy Store both reject debug-signed artifacts, so the failure surfaces at
 * the store upload, which is the worst possible place to discover it.
 *
 * This plugin re-applies the config on every prebuild, so the generated project
 * is correct by construction rather than by remembering.
 *
 * WHERE THE CREDENTIALS COME FROM
 *
 * Never from this repo. The keystore file lives at
 * `~/.config/lunker/upload-keystore.jks` and its password in
 * `~/.config/lunker/secrets.env`, per the system contract that credentials live
 * in `~/.config/<tool>/` and never in the tree. They reach Gradle as
 * environment variables:
 *
 *   LUNKER_KEYSTORE_PATH, LUNKER_KEYSTORE_ALIAS, LUNKER_KEYSTORE_PASSWORD
 *
 * IF THEY ARE ABSENT
 *
 * The release build is left signed with the debug keystore, exactly as the
 * stock template leaves it, and a loud warning is printed. It does not throw:
 * CI and contributors must still be able to run a release build to check that
 * it compiles, and they have no business holding the upload key. The artifact
 * that comes out is simply not store-uploadable, which the warning says.
 */

const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING_CONFIG = `
        release {
            storeFile file(System.getenv("LUNKER_KEYSTORE_PATH"))
            storePassword System.getenv("LUNKER_KEYSTORE_PASSWORD")
            keyAlias System.getenv("LUNKER_KEYSTORE_ALIAS")
            keyPassword System.getenv("LUNKER_KEYSTORE_PASSWORD")
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected a Groovy build.gradle');
    }

    const hasCredentials =
      !!process.env.LUNKER_KEYSTORE_PATH &&
      !!process.env.LUNKER_KEYSTORE_ALIAS &&
      !!process.env.LUNKER_KEYSTORE_PASSWORD;

    if (!hasCredentials) {
      console.warn(
        '\n⚠️  withReleaseSigning: LUNKER_KEYSTORE_* not set — the release build will be\n' +
          '   signed with the DEBUG keystore. It will install and run, but Google Play and\n' +
          '   the Samsung Galaxy Store will both reject it. Source the credentials with:\n' +
          '     set -a; . ~/.config/lunker/secrets.env; set +a\n',
      );
      return cfg;
    }

    let src = cfg.modResults.contents;

    // Add a `release` block alongside the template's `debug` block. Anchored on
    // the debug block's closing brace so we do not depend on whitespace
    // elsewhere in a generated file.
    const DEBUG_BLOCK = /(signingConfigs \{[\s\S]*?keyPassword 'android'\n\s*\})/;
    if (!DEBUG_BLOCK.test(src)) {
      throw new Error(
        'withReleaseSigning: could not find the debug signingConfig block. The Expo ' +
          'template changed; re-derive the anchor rather than loosening this regex.',
      );
    }
    src = src.replace(DEBUG_BLOCK, `$1${RELEASE_SIGNING_CONFIG}`);

    // Point the release buildType at it. The template ships
    // `signingConfig signingConfigs.debug` inside buildTypes.release, and the
    // identical line also appears in buildTypes.debug — so replace only the
    // occurrence that follows the release template's own comment.
    const RELEASE_USES_DEBUG =
      /(release \{\n\s*\/\/ Caution![\s\S]*?\n\s*)signingConfig signingConfigs\.debug/;
    if (!RELEASE_USES_DEBUG.test(src)) {
      throw new Error(
        'withReleaseSigning: buildTypes.release no longer points at signingConfigs.debug. ' +
          'Verify what it points at now before assuming this plugin is still needed.',
      );
    }
    src = src.replace(RELEASE_USES_DEBUG, '$1signingConfig signingConfigs.release');

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = withReleaseSigning;
