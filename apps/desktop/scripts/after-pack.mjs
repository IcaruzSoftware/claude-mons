// electron-builder afterPack hook (wired up from electron-builder.yml's `afterPack:`).
//
// electron-builder's own PublishManager writes resources/app-update.yml from its "afterPack"
// event, but only when that event actually fires with a target electron-updater can use:
//   - a bare `--dir` build packages with an internal "dir" no-op target, which fails
//     PublishManager's isSuitableWindowsTarget() check on Windows, so it skips the write
//   - a `--prepackaged <dir>` build returns out of PlatformPackager#doPack before the
//     "afterPack" event is emitted at all, so nothing downstream of it runs, for any platform
//
// CI's Windows job (.github/workflows/release.yml) packages in exactly that two-step sequence
// (`--win --dir --publish never`, then `--win --prepackaged release/win-unpacked --publish
// never`) so the app-update.yml would never be written and every installed build fails with
// electron-updater's `ENOENT ... app-update.yml`. This hook fills the gap: the first, `--dir`
// pass still emits "afterPack" normally, so it writes the file here directly into
// win-unpacked/resources; by the time the second, `--prepackaged` pass zips that directory into
// the NSIS installer, the file is already there. Idempotent: if electron-builder already wrote it
// natively (e.g. a plain `electron-builder --win` build, or any Linux target), this is a no-op.
//
// See docs/runbooks/release.md for the full explanation.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  // Only nsis (win) and AppImage/deb (linux) update in place; macOS is not built by this project.
  if (electronPlatformName !== 'win32' && electronPlatformName !== 'linux') return;

  const resourcesDir = packager.getResourcesDir(appOutDir);
  const target = path.join(resourcesDir, 'app-update.yml');
  if (existsSync(target)) return; // electron-builder already wrote it natively for this pass

  const publish = Array.isArray(packager.config.publish)
    ? packager.config.publish[0]
    : packager.config.publish;
  if (publish == null || publish.provider == null) return; // no publish config, nothing to derive

  const fields = {
    provider: publish.provider,
    owner: publish.owner,
    repo: publish.repo,
    releaseType: publish.releaseType,
    // Same value electron-builder's native writer would use (packager.appInfo.updaterCacheDirName),
    // derived from the `extraMetadata.name` override in electron-builder.yml.
    updaterCacheDirName: packager.appInfo.updaterCacheDirName,
  };
  const yaml =
    Object.entries(fields)
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n') + '\n';

  await mkdir(resourcesDir, { recursive: true });
  await writeFile(target, yaml, 'utf8');
  console.info(
    `after-pack: wrote ${path.relative(process.cwd(), target)} (electron-builder skipped it for this build step)`,
  );
}
