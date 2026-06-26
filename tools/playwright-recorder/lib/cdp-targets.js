function targetUrl(target) {
  return typeof target?.url === 'string' ? target.url : '';
}

function pageTargets(cdpInfo) {
  const result = [];
  for (const endpointInfo of cdpInfo.cdp || []) {
    if (!Array.isArray(endpointInfo.targets)) continue;
    for (const target of endpointInfo.targets) {
      if (target?.type === 'page') {
        result.push({
          endpoint: endpointInfo.endpoint,
          ...target,
        });
      }
    }
  }
  return result;
}

function findPageTarget(cdpInfo, urlHint = 'salonboard.com') {
  const pages = pageTargets(cdpInfo);
  const hint = String(urlHint || '').toLowerCase();
  return pages.find(target => targetUrl(target).toLowerCase().includes(hint))
    || pages.find(target => {
      const url = targetUrl(target);
      return url && url !== 'about:blank';
    })
    || pages[0]
    || null;
}

function summarizeTarget(target) {
  if (!target) return null;
  return {
    id: target.id || null,
    type: target.type || null,
    title: target.title || null,
    url: target.url || null,
  };
}

function summarizeObservedTarget(target) {
  if (!target) return null;
  return {
    endpoint: target.endpoint || null,
    id: target.id || null,
    type: target.type || null,
    title: target.title || null,
    url: target.url || null,
    attached: target.attached ?? null,
  };
}

function buildObservedBrowserStatus(cdpInfo, options = {}) {
  const urlHint = options.urlHint || 'salonboard.com';
  const sharedProfilePath = options.sharedProfilePath || null;
  const processes = cdpInfo.processes || [];
  const sharedProcesses = sharedProfilePath
    ? processes.filter(processInfo => processInfo.userDataDir === sharedProfilePath)
    : processes;
  const targets = pageTargets(cdpInfo).map(summarizeObservedTarget);
  const selectedTarget = summarizeObservedTarget(findPageTarget(cdpInfo, urlHint));
  const activePorts = (cdpInfo.activePorts || []).map(activePort => ({
    path: activePort.path || null,
    port: activePort.port ?? null,
    browserPath: activePort.browserPath || null,
    error: activePort.error || null,
  }));

  return {
    ok: true,
    source: 'cdp',
    selectionHint: urlHint,
    running: sharedProcesses.length > 0,
    processIds: sharedProcesses.map(processInfo => processInfo.pid),
    remoteDebuggingPorts: [...(cdpInfo.ports || [])].sort((left, right) => left - right),
    activePorts,
    targetCount: targets.length,
    currentTarget: selectedTarget,
    currentUrl: selectedTarget?.url || null,
    currentTitle: selectedTarget?.title || null,
    targets,
  };
}

module.exports = {
  buildObservedBrowserStatus,
  findPageTarget,
  pageTargets,
  summarizeObservedTarget,
  summarizeTarget,
  targetUrl,
};
