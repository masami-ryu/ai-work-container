const { summarizeTarget } = require('./cdp-targets');

function classifyCdpSnapshotError(error) {
  const message = error?.stack || error?.message || String(error);
  if (/javascript dialog|dialog is showing|user prompt|alert|confirm|prompt/i.test(message)) {
    return {
      errorCode: 'JAVASCRIPT_DIALOG_OPEN',
      hint: 'A browser JavaScript dialog is blocking page evaluation. Resolve the dialog in noVNC, then retry the snapshot.',
      message,
    };
  }
  if (error?.cdpMethod === 'Runtime.evaluate' && /timed out/i.test(message)) {
    return {
      errorCode: 'CDP_RUNTIME_EVALUATE_TIMEOUT',
      hint: 'Runtime.evaluate timed out. A browser JavaScript dialog may be blocking page execution; check noVNC and retry.',
      message,
    };
  }
  return {
    errorCode: 'CDP_SNAPSHOT_FAILED',
    hint: 'CDP snapshot failed before page metadata could be written.',
    message,
  };
}

function extractJsonObjectsFromText(text) {
  const source = String(text || '');
  const objects = [];
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf('{', index);
    if (start < 0) break;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let cursor = start; cursor < source.length; cursor += 1) {
      const char = source[cursor];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = source.slice(start, cursor + 1);
          try {
            objects.push(JSON.parse(candidate));
            index = cursor + 1;
          } catch {
            index = start + 1;
          }
          break;
        }
      }

      if (cursor === source.length - 1) {
        index = start + 1;
      }
    }
  }

  return objects;
}

function extractResultDiagnostics(result) {
  const jsonObjects = extractJsonObjectsFromText(result?.stdout);
  const withOutput = [...jsonObjects].reverse().find(item => item && typeof item.output === 'string');
  const withHint = [...jsonObjects].reverse().find(item => item && typeof item.hint === 'string');
  const withTarget = [...jsonObjects].reverse().find(item => item?.selectedTarget);
  const withErrorCode = [...jsonObjects].reverse().find(item => item && typeof item.errorCode === 'string');

  return {
    output: result?.output || withOutput?.output || null,
    hint: result?.recoveryHint || result?.hint || withHint?.hint || null,
    target: summarizeTarget(result?.selectedTarget || withTarget?.selectedTarget),
    errorCode: result?.errorCode || withErrorCode?.errorCode || null,
  };
}

function buildLastCommand({ requestedCommand, command, args, result, now = new Date() }) {
  const diagnostics = extractResultDiagnostics(result);
  const last = {
    requestedCommand,
    command,
    args,
    code: result.code,
    ok: result.code === 0,
    timedOut: Boolean(result.timedOut),
    finishedAt: now.toISOString(),
    errorCode: diagnostics.errorCode,
  };

  if (diagnostics.output) last.output = diagnostics.output;
  if (diagnostics.hint) last.hint = diagnostics.hint;
  if (diagnostics.target) last.target = diagnostics.target;

  return last;
}

module.exports = {
  buildLastCommand,
  classifyCdpSnapshotError,
  extractJsonObjectsFromText,
  extractResultDiagnostics,
};
