// --- State ---
let sessions = {};
let pendingDecisions = {};
let ws = null;
let reconnectDelay = 1000;
let muted = false;
let audioCtx = null;

// --- Audio ---
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playBeep(freq, duration, count = 1, type = 'sine') {
  if (muted) return;
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();

  for (let i = 0; i < count; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (i * 0.3) + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.3);
    osc.stop(ctx.currentTime + (i * 0.3) + duration);
  }
}

function playPermissionSound() {
  playBeep(880, 0.15, 2, 'square');
}

function playQuestionSound() {
  playBeep(660, 0.2, 1, 'sine');
}

function playCompletedSound() {
  if (muted) return;
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  // 和音
  [523.25, 659.25, 783.99].forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  });
}

// --- Desktop Notification ---
function sendDesktopNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '🤖' });
  }
}

// --- DOM ---
const sessionsContainer = document.getElementById('sessions-container');
const emptyMessage = document.getElementById('empty-message');
const connectionStatus = document.getElementById('connection-status');
const activeCount = document.getElementById('active-count');
const muteBtn = document.getElementById('mute-btn');
const notificationBtn = document.getElementById('notification-btn');
const eventLog = document.getElementById('event-log');
const logCount = document.getElementById('log-count');

muteBtn.addEventListener('click', () => {
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

notificationBtn.addEventListener('click', async () => {
  // AudioContext もここで初期化（ブラウザ自動再生ポリシー対策）
  getAudioContext();
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      notificationBtn.textContent = '🔔 通知ON';
    }
  } else if (Notification.permission === 'granted') {
    notificationBtn.textContent = '🔔 通知ON';
  }
});

// --- Event Log ---
let logEntries = 0;
function addLogEntry(eventType, sessionId, detail) {
  const time = new Date().toLocaleTimeString('ja-JP');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-event">${eventType}</span><span>${sessionId?.substring(0, 8) || ''} ${detail || ''}</span>`;
  eventLog.prepend(entry);
  logEntries++;
  logCount.textContent = logEntries;
  // Keep max 200 entries
  while (eventLog.children.length > 200) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

// --- Render ---
const STATUS_LABELS = {
  running: '🟢 実行中',
  waiting_permission: '🟡 承認待ち',
  waiting_answer: '🟠 質問待ち',
  idle: '🔵 入力待ち',
  error: '🔴 エラー',
  completed: '✅ 完了',
};

function renderSessions() {
  const ids = Object.keys(sessions);
  emptyMessage.style.display = ids.length === 0 ? 'block' : 'none';

  // Count active
  const active = ids.filter(id => !['completed'].includes(sessions[id].status));
  activeCount.textContent = `${active.length} active / ${ids.length} total`;

  // Remove stale cards
  for (const card of sessionsContainer.querySelectorAll('.session-card')) {
    if (!sessions[card.dataset.sessionId]) {
      card.remove();
    }
  }

  // Sort: waiting_permission first, then waiting_answer, running, idle, error, completed
  const order = { waiting_permission: 0, waiting_answer: 1, running: 2, error: 3, idle: 4, completed: 5 };
  const sorted = ids.sort((a, b) => (order[sessions[a].status] ?? 9) - (order[sessions[b].status] ?? 9));

  sorted.forEach(id => {
    const session = sessions[id];
    let card = sessionsContainer.querySelector(`.session-card[data-session-id="${id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'session-card';
      card.dataset.sessionId = id;
      sessionsContainer.appendChild(card);
    }
    card.className = `session-card status-${session.status}`;
    card.innerHTML = renderCard(session);
  });

  // Bind event handlers
  bindDecisionButtons();
  bindResetErrorButtons();
}

function renderCard(session) {
  const shortId = session.session_id.substring(0, 8);
  const cwd = session.cwd ? session.cwd.split('/').pop() : '-';
  const updatedAt = new Date(session.updated_at).toLocaleTimeString('ja-JP');
  const statusLabel = STATUS_LABELS[session.status] || session.status;

  let html = `
    <div class="card-header">
      <span class="session-id">${shortId}...</span>
      <span class="status-badge badge-${session.status}">${statusLabel}</span>
    </div>
    <div class="card-info">
      <div><span class="label">CWD:</span>${escapeHtml(cwd)}</div>
      ${session.model ? `<div><span class="label">Model:</span>${escapeHtml(session.model)}</div>` : ''}
      <div><span class="label">更新:</span>${updatedAt}</div>
    </div>
  `;

  if (session.status_text) {
    html += `<div class="status-text">${escapeHtml(session.status_text)}</div>`;
  }

  // Decision panel
  const decisions = Object.values(pendingDecisions).filter(
    d => d.session_id === session.session_id && d.status === 'pending'
  );
  if (decisions.length > 0) {
    decisions.forEach(d => {
      html += renderDecisionPanel(d);
    });
  }

  // Question panel
  if (session.status === 'waiting_answer' && session.questions && session.questions.length > 0) {
    html += renderQuestionPanel(session.questions);
  } else if (session.status === 'waiting_answer') {
    html += `
      <div class="question-panel">
        <h4>質問発生</h4>
        <p class="terminal-notice">ターミナルで質問内容を確認してください</p>
      </div>
    `;
  }

  // Error panel
  if (session.status === 'error') {
    html += renderErrorPanel(session);
  }

  // Last message
  if (session.last_message && session.status === 'idle') {
    html += `<div class="last-message">${escapeHtml(truncate(session.last_message, 150))}</div>`;
  }

  // Milestones
  if (session.milestones && session.milestones.length > 0) {
    html += `<div class="milestones">`;
    session.milestones.slice(-3).forEach(m => {
      html += `<div class="milestone-item">🏁 ${escapeHtml(m.milestone)}${m.details ? ` - ${escapeHtml(m.details)}` : ''}</div>`;
    });
    html += `</div>`;
  }

  return html;
}

function renderDecisionPanel(decision) {
  const toolName = decision.tool_name || 'Unknown';
  let preview = toolName;
  if (decision.tool_input) {
    if (decision.tool_input.command) {
      preview = `Bash: ${decision.tool_input.command}`;
    } else if (decision.tool_input.file_path) {
      preview = `${toolName}: ${decision.tool_input.file_path}`;
    } else {
      preview = `${toolName}: ${JSON.stringify(decision.tool_input).substring(0, 200)}`;
    }
  }

  const elapsed = Math.floor((Date.now() - new Date(decision.created_at).getTime()) / 1000);
  const remaining = Math.max(0, 280 - elapsed);

  return `
    <div class="decision-panel" data-decision-id="${decision.id}">
      <h4>承認待ち: ${escapeHtml(toolName)}</h4>
      <div class="tool-preview">${escapeHtml(preview)}</div>
      <div class="decision-buttons">
        <button class="btn-allow" data-decision-id="${decision.id}">✓ Allow</button>
        <button class="btn-deny" data-decision-id="${decision.id}">✗ Deny</button>
        <span class="countdown" data-decision-id="${decision.id}">残り ${remaining}s</span>
      </div>
    </div>
  `;
}

function renderQuestionPanel(questions) {
  let html = `<div class="question-panel"><h4>質問</h4>`;
  questions.forEach(q => {
    html += `<div class="question-item">`;
    if (q.header) {
      html += `<div class="question-header">${escapeHtml(q.header)}</div>`;
    }
    html += `<div class="question-text">${escapeHtml(q.question)}</div>`;
    if (q.options && q.options.length > 0) {
      html += `<ul class="question-options">`;
      q.options.forEach(opt => {
        html += `<li><span class="opt-label">${escapeHtml(opt.label)}</span>`;
        if (opt.description) {
          html += `<span class="opt-desc">${escapeHtml(opt.description)}</span>`;
        }
        html += `</li>`;
      });
      html += `</ul>`;
    }
    html += `</div>`;
  });
  html += `<p class="terminal-notice">回答はターミナルで入力してください</p></div>`;
  return html;
}

function renderErrorPanel(session) {
  const errorAt = session.error_at ? new Date(session.error_at).toLocaleTimeString('ja-JP') : '';
  return `
    <div class="error-panel">
      <h4>エラー</h4>
      <p>${escapeHtml(session.error_info || '不明なエラー')}</p>
      ${errorAt ? `<p style="font-size:11px;color:#888;">発生: ${errorAt}</p>` : ''}
      <button class="btn-reset-error" data-session-id="${session.session_id}">idle に戻す</button>
    </div>
  `;
}

function bindDecisionButtons() {
  document.querySelectorAll('.btn-allow').forEach(btn => {
    btn.onclick = () => respondDecision(btn.dataset.decisionId, 'allow');
  });
  document.querySelectorAll('.btn-deny').forEach(btn => {
    btn.onclick = () => respondDecision(btn.dataset.decisionId, 'deny');
  });
}

function bindResetErrorButtons() {
  document.querySelectorAll('.btn-reset-error').forEach(btn => {
    btn.onclick = () => resetError(btn.dataset.sessionId);
  });
}

// --- API ---
async function respondDecision(id, decision) {
  try {
    const res = await fetch(`/api/decisions/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      console.error('Decision respond failed:', await res.text());
    }
  } catch (e) {
    console.error('Decision respond error:', e);
  }
}

async function resetError(sessionId) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/reset-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.error('Reset error failed:', await res.text());
    }
  } catch (e) {
    console.error('Reset error:', e);
  }
}

async function fetchInitialState() {
  try {
    const [sessRes, decRes] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/decisions/pending'),
    ]);
    const sessList = await sessRes.json();
    const decList = await decRes.json();
    sessions = {};
    sessList.forEach(s => { sessions[s.session_id] = s; });
    pendingDecisions = {};
    decList.forEach(d => { pendingDecisions[d.id] = d; });
    renderSessions();
  } catch (e) {
    console.error('Failed to fetch initial state:', e);
  }
}

// --- Countdown timer ---
setInterval(() => {
  document.querySelectorAll('.countdown').forEach(el => {
    const decisionId = el.dataset.decisionId;
    const decision = pendingDecisions[decisionId];
    if (!decision) return;
    const elapsed = Math.floor((Date.now() - new Date(decision.created_at).getTime()) / 1000);
    const remaining = Math.max(0, 280 - elapsed);
    el.textContent = `残り ${remaining}s`;
    if (remaining === 0) {
      el.textContent = 'タイムアウト';
      el.style.color = '#f44336';
    }
  });
}, 1000);

// --- WebSocket ---
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    connectionStatus.textContent = '● Connected';
    connectionStatus.className = 'status-indicator connected';
    reconnectDelay = 1000;
    fetchInitialState();
  };

  ws.onclose = () => {
    connectionStatus.textContent = '● Disconnected';
    connectionStatus.className = 'status-indicator disconnected';
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
}

function scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connectWebSocket();
  }, reconnectDelay);
}

function handleMessage(msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'session_update': {
      const session = payload;
      const prev = sessions[session.session_id];
      sessions[session.session_id] = session;

      // Sound + notification on state transitions
      if (!prev || prev.status !== session.status) {
        if (session.status === 'waiting_permission') {
          playPermissionSound();
          sendDesktopNotification('承認待ち', `${session.session_id.substring(0, 8)}: 承認が必要です`);
        } else if (session.status === 'waiting_answer') {
          playQuestionSound();
          const qText = session.questions?.[0]?.question || '質問が発生しました';
          sendDesktopNotification('質問', qText);
        } else if (session.status === 'completed') {
          playCompletedSound();
          sendDesktopNotification('完了', `セッション ${session.session_id.substring(0, 8)} が完了しました`);
        }
      }

      addLogEntry(session.status, session.session_id, '');
      renderSessions();
      break;
    }

    case 'decision_pending': {
      const decision = payload;
      pendingDecisions[decision.id] = decision;
      addLogEntry('decision_pending', decision.session_id, decision.tool_name);
      renderSessions();
      break;
    }

    case 'decision_resolved': {
      const decision = payload;
      delete pendingDecisions[decision.id];
      addLogEntry('decision_resolved', decision.session_id, `${decision.tool_name} → ${decision.result}`);
      renderSessions();
      break;
    }

    case 'notification': {
      addLogEntry('notification', payload.session_id, payload.message || payload.notification_type);
      break;
    }
  }
}

// --- Utils ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.substring(0, max) + '...';
}

// --- Init ---
connectWebSocket();
