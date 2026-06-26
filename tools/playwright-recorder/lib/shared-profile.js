const fs = require('fs');
const path = require('path');

const lockFileNames = ['SingletonCookie', 'SingletonLock', 'SingletonSocket'];

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function pathExistsOrBrokenSymlink(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function jstTimestamp(now = Date.now()) {
  const date = new Date(now + 9 * 60 * 60 * 1000);
  return date.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(2, 15);
}

function createSharedProfileManager(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const profile = options.profile || '.pw-profile-shared';
  const profilePath = options.profilePath || path.join(workspaceRoot, profile);
  const backupPrefix = options.backupPrefix || `${profile}.backup`;
  const isProcessRunningImpl = options.isProcessRunning || isProcessRunning;
  const now = options.now || (() => Date.now());

  function getProfileLockStatus() {
    const lockPaths = lockFileNames.map(name => path.join(profilePath, name));
    const existing = lockPaths.filter(lockPath => pathExistsOrBrokenSymlink(lockPath));
    const lockPath = path.join(profilePath, 'SingletonLock');
    let lockTarget = null;
    let lockPid = null;
    let lockPidRunning = false;

    if (pathExistsOrBrokenSymlink(lockPath)) {
      try {
        lockTarget = fs.readlinkSync(lockPath);
        const match = lockTarget.match(/-(\d+)$/);
        lockPid = match ? Number(match[1]) : null;
        lockPidRunning = isProcessRunningImpl(lockPid);
      } catch (error) {
        lockTarget = `unreadable: ${error.message}`;
      }
    }

    return {
      profile,
      exists: fs.existsSync(profilePath),
      locked: existing.length > 0,
      stale: existing.length > 0 && !lockPidRunning,
      lockTarget,
      lockPid,
      lockPidRunning,
      files: existing.map(lockPath => path.basename(lockPath)),
    };
  }

  function cleanupStaleProfileLock() {
    const lockStatus = getProfileLockStatus();
    if (!lockStatus.stale) return { cleaned: false, lockStatus };

    for (const name of lockFileNames) {
      fs.rmSync(path.join(profilePath, name), { force: true });
    }

    return {
      cleaned: true,
      lockStatus: getProfileLockStatus(),
    };
  }

  function profileBackupPath() {
    const base = path.join(workspaceRoot, `${backupPrefix}-${jstTimestamp(now())}`);
    let candidate = base;
    let index = 2;
    while (fs.existsSync(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    return candidate;
  }

  function backupSharedProfile() {
    if (!fs.existsSync(profilePath)) return null;

    const backupPath = profileBackupPath();
    fs.cpSync(profilePath, backupPath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
    });

    return {
      path: path.relative(workspaceRoot, backupPath),
      absolutePath: backupPath,
      files: ['Default/Bookmarks', 'Default/Bookmarks.bak']
        .filter(file => fs.existsSync(path.join(backupPath, file))),
    };
  }

  async function resetSharedProfile(args, options = {}) {
    if (!args.includes('--confirm')) {
      return {
        code: 1,
        stdout: '',
        stderr: 'shared-reset requires --confirm because it deletes the shared Chrome profile after creating a backup',
        errorCode: 'CONFIRMATION_REQUIRED',
        recoveryHint: 'Use shared-open first. Run shared-reset --confirm only as a last resort.',
        profileLock: getProfileLockStatus(),
      };
    }

    const closeSharedBrowser = options.closeSharedBrowser || (async () => ({ stdout: '', stderr: '' }));
    const closeResult = await closeSharedBrowser();
    const lockStatus = getProfileLockStatus();
    if (lockStatus.locked && !lockStatus.stale) {
      return {
        code: 1,
        stdout: closeResult.stdout,
        stderr: closeResult.stderr,
        errorCode: 'PROFILE_LOCKED',
        recoveryHint: 'Close Chrome from noVNC before running shared-reset.',
        profileLock: lockStatus,
      };
    }

    const backup = backupSharedProfile();
    fs.rmSync(profilePath, { recursive: true, force: true });

    return {
      code: 0,
      stdout: `${closeResult.stdout || ''}Shared profile backup: ${backup ? backup.path : '(profile did not exist)'}\nShared profile reset: ${profile}\n`,
      stderr: closeResult.stderr || '',
      backup,
      profileLock: getProfileLockStatus(),
    };
  }

  return {
    profile,
    profilePath,
    getProfileLockStatus,
    cleanupStaleProfileLock,
    backupSharedProfile,
    resetSharedProfile,
  };
}

module.exports = {
  createSharedProfileManager,
  isProcessRunning,
  jstTimestamp,
  pathExistsOrBrokenSymlink,
};
