const path = require('path');

class InvalidOutputPathError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidOutputPathError';
    this.errorCode = 'INVALID_OUTPUT_PATH';
    Object.assign(this, details);
  }
}

function hasUnsafePathSegment(filename) {
  return String(filename).split(/[\\/]+/).some(segment => segment === '..');
}

function normalizeRelativeFilename(filename) {
  return String(filename).replace(/\\/g, '/');
}

function resolveAllowedOutputPath({ workspaceRoot, filename, baseDir, extensions }) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new InvalidOutputPathError('output filename is required', { filename });
  }
  if (/[\0\r\n]/.test(filename)) {
    throw new InvalidOutputPathError('output filename contains invalid characters', { filename });
  }
  if (path.isAbsolute(filename) || path.win32.isAbsolute(filename) || hasUnsafePathSegment(filename)) {
    throw new InvalidOutputPathError('output filename must be a relative path inside the allowed output directory', { filename });
  }

  const root = path.resolve(workspaceRoot);
  const allowedRoot = path.resolve(root, baseDir);
  const normalizedFilename = normalizeRelativeFilename(filename);
  const resolved = path.resolve(root, normalizedFilename);
  const allowedExtensions = extensions.map(extension => extension.toLowerCase());

  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new InvalidOutputPathError(`output filename must be inside ${baseDir}/`, { filename });
  }
  if (!allowedExtensions.includes(path.extname(resolved).toLowerCase())) {
    throw new InvalidOutputPathError(`output filename must end with ${allowedExtensions.join(' or ')}`, { filename });
  }

  return {
    absolutePath: resolved,
    relativePath: path.relative(root, resolved),
  };
}

function optionValueLocation(args, option) {
  const exactIndex = args.indexOf(option);
  if (exactIndex >= 0) {
    return {
      style: 'separate',
      optionIndex: exactIndex,
      valueIndex: exactIndex + 1,
      value: args[exactIndex + 1],
    };
  }

  const prefixedIndex = args.findIndex(arg => arg.startsWith(`${option}=`));
  if (prefixedIndex >= 0) {
    return {
      style: 'inline',
      optionIndex: prefixedIndex,
      valueIndex: prefixedIndex,
      value: args[prefixedIndex].slice(option.length + 1),
    };
  }

  return null;
}

function sanitizeFilenameOption(args, option, policy) {
  const location = optionValueLocation(args, option);
  if (!location) return args;
  const sanitized = resolveAllowedOutputPath({
    ...policy,
    filename: location.value,
  });
  const nextArgs = [...args];
  if (location.style === 'inline') {
    nextArgs[location.optionIndex] = `${option}=${sanitized.relativePath}`;
  } else {
    nextArgs[location.valueIndex] = sanitized.relativePath;
  }
  return nextArgs;
}

function sanitizePositionalFilename(args, index, policy) {
  if (args[index] == null) return args;
  const sanitized = resolveAllowedOutputPath({
    ...policy,
    filename: args[index],
  });
  const nextArgs = [...args];
  nextArgs[index] = sanitized.relativePath;
  return nextArgs;
}

function sanitizeCommandOutputArgs(command, args, options = {}) {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  if (command === 'snapshot') {
    return sanitizeFilenameOption(args, '--filename', {
      workspaceRoot,
      baseDir: 'snapshots',
      extensions: ['.md'],
    });
  }
  if (command === 'screenshot') {
    return sanitizeFilenameOption(args, '--filename', {
      workspaceRoot,
      baseDir: 'screenshots',
      extensions: ['.png'],
    });
  }
  if (command === 'shared-snapshot' || command === 'shared-cdp-snapshot') {
    return sanitizePositionalFilename(args, 0, {
      workspaceRoot,
      baseDir: 'snapshots',
      extensions: ['.md'],
    });
  }
  return args;
}

module.exports = {
  InvalidOutputPathError,
  resolveAllowedOutputPath,
  sanitizeCommandOutputArgs,
};
