import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import semver from 'semver';
import {supportedPackageManagers, PackageManagerInfo} from './package-managers';

// Build and dependency caching rely on `go env GOCACHE`/`GOMODCACHE`.
// GOCACHE was introduced in Go 1.10, so older versions expose neither cache
// directory; `go env` returns empty output for both variables. Caching is
// therefore unsupported (and meaningless) for Go versions before 1.10.
export const MINIMUM_GO_VERSION_FOR_CACHE = '1.10.0';

export const getCommandOutput = async (toolCommand: string) => {
  let {stdout, stderr, exitCode} = await exec.getExecOutput(
    toolCommand,
    undefined,
    {ignoreReturnCode: true}
  );

  if (exitCode) {
    stderr = !stderr.trim()
      ? `The '${toolCommand}' command failed with exit code: ${exitCode}`
      : stderr;
    throw new Error(stderr);
  }

  return stdout.trim();
};

export const getPackageManagerInfo = async (packageManager: string) => {
  if (!supportedPackageManagers[packageManager]) {
    throw new Error(
      `It's not possible to use ${packageManager}, please, check correctness of the package manager name spelling.`
    );
  }
  const obtainedPackageManager = supportedPackageManagers[packageManager];

  return obtainedPackageManager;
};

/**
 * Returns the installed Go version (e.g. "1.9.7") by parsing `go version`.
 * Example output: "go version go1.9.7 linux/amd64".
 */
export const getGoVersion = async (): Promise<string> => {
  const versionOutput = await getCommandOutput('go version');
  const versionToken = versionOutput.split(' ')[2];
  return versionToken?.startsWith('go') ? versionToken.slice('go'.length) : '';
};

/**
 * Determines whether the installed Go version supports build/dependency
 * caching. Go versions before 1.10 don't expose GOCACHE/GOMODCACHE, so
 * caching should be skipped for them without emitting warnings.
 */
export const isCacheSupported = (goVersion: string): boolean => {
  const coercedVersion = semver.coerce(goVersion);

  // If the version can't be parsed, don't block caching.
  if (!coercedVersion) {
    return true;
  }

  return semver.gte(coercedVersion, MINIMUM_GO_VERSION_FOR_CACHE);
};

export const getCacheDirectoryPath = async (
  packageManagerInfo: PackageManagerInfo
) => {
  const pathOutputs = await Promise.allSettled(
    packageManagerInfo.cacheFolderCommandList.map(async command =>
      getCommandOutput(command)
    )
  );

  const results = pathOutputs.map(item => {
    if (item.status === 'fulfilled') {
      return item.value;
    } else {
      core.info(`[warning]getting cache directory path failed: ${item.reason}`);
    }

    return '';
  });

  const cachePaths = results.filter(item => item);

  if (!cachePaths.length) {
    throw new Error(`Could not get cache folder paths.`);
  }

  return cachePaths;
};

export function isGhes(): boolean {
  const ghUrl = new URL(
    process.env['GITHUB_SERVER_URL'] || 'https://github.com'
  );

  const hostname = ghUrl.hostname.trimEnd().toUpperCase();
  const isGitHubHost = hostname === 'GITHUB.COM';
  const isGitHubEnterpriseCloudHost = hostname.endsWith('.GHE.COM');
  const isLocalHost = hostname.endsWith('.LOCALHOST');

  return !isGitHubHost && !isGitHubEnterpriseCloudHost && !isLocalHost;
}

export function isCacheFeatureAvailable(): boolean {
  if (cache.isFeatureAvailable()) {
    return true;
  }

  if (isGhes()) {
    core.warning(
      'Cache action is only supported on GHES version >= 3.5. If you are on version >=3.5 Please check with GHES admin if Actions cache service is enabled or not.'
    );
    return false;
  }

  core.warning(
    'The runner was not able to contact the cache service. Caching will be skipped'
  );
  return false;
}
