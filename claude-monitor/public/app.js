// --- State ---
let sessions = {};
let pendingDecisions = {};
let groups = {};
let promptTemplates = {}; // id -> PromptTemplate
let promptHistories = {}; // "group:<id>" or "session:<id>" -> string[]
let selectedGroupId = null; // null=すべて, 'ungrouped'=未分類, string=グループID
let toggledSessions = new Set(); // デフォルト状態から反転されたセッション
let ws = null;
let reconnectDelay = 1000;
let muted = false;
let audioCtx = null;
let availableTools = []; // GET /api/tools から取得

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

function playIdleSound() {
  playBeep(440, 0.2, 1, 'sine');
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
const launchBtn = document.getElementById('launch-session-btn');
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

// --- Launch Session ---
async function fetchTools() {
  try {
    const res = await fetch('/api/tools');
    if (!res.ok) return;
    availableTools = await res.json();
    const hasAvailable = availableTools.some(t => t.available);
    launchBtn.style.display = hasAvailable ? '' : 'none';
  } catch (e) {
    console.error('Failed to fetch tools:', e);
  }
}

launchBtn.addEventListener('click', async () => {
  const tools = availableTools.filter(t => t.available);
  if (tools.length === 0) return;

  let toolId;
  if (tools.length === 1) {
    toolId = tools[0].id;
  } else {
    // 複数ツール時はドロップダウン選択
    const labels = tools.map((t, i) => `${i + 1}: ${t.label}`).join('\n');
    const choice = prompt(`起動するツールを選択:\n${labels}`);
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= tools.length) return;
    toolId = tools[idx].id;
  }

  launchBtn.disabled = true;
  launchBtn.textContent = '起動中...';
  try {
    const res = await fetch('/api/sessions/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_id: toolId }),
    });
    if (res.ok) {
      const data = await res.json();
      addLogEntry('launch', '', `セッションを起動しました: ${data.tmux_pane}`);
    } else {
      const data = await res.json().catch(() => ({}));
      let msg;
      if (res.status === 400) {
        msg = `起動に失敗しました: ${data.error || 'パラメータが不正です'}`;
      } else if (res.status === 409) {
        msg = '起動に失敗しました: ペイン数が上限に達しています';
      } else if (res.status === 503) {
        msg = '起動に失敗しました: tmuxに接続されていません';
      } else {
        msg = '起動に失敗しました: 予期しないエラーが発生しました';
      }
      addLogEntry('launch-error', '', msg);
    }
  } catch (e) {
    console.error('Launch session error:', e);
    addLogEntry('launch-error', '', '起動に失敗しました: 通信エラー');
  } finally {
    launchBtn.disabled = false;
    launchBtn.textContent = '＋ 新規セッション';
  }
});

// --- Event Log ---
let logEntries = 0;
function addLogEntry(eventType, sessionId, detail) {
  const time = new Date().toLocaleTimeString('ja-JP');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = time;
  const eventSpan = document.createElement('span');
  eventSpan.className = 'log-event';
  eventSpan.textContent = eventType;
  const detailSpan = document.createElement('span');
  detailSpan.textContent = `${sessionId?.substring(0, 8) || ''} ${detail || ''}`;
  entry.append(timeSpan, eventSpan, detailSpan);
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

function isCollapsed(session) {
  const defaultCollapsed = session.status === 'completed';
  const toggled = toggledSessions.has(session.session_id);
  return defaultCollapsed ? !toggled : toggled;
}

function renderSessions() {
  // textarea入力値を退避
  const savedTexts = {};
  document.querySelectorAll('.send-keys-textarea').forEach(ta => {
    if (ta.value) savedTexts[ta.dataset.sessionId] = ta.value;
  });

  let ids = Object.keys(sessions);

  // グループフィルタ
  if (selectedGroupId === 'ungrouped') {
    ids = ids.filter(id => !getSessionGroupId(id));
  } else if (selectedGroupId) {
    const group = groups[selectedGroupId];
    if (group) {
      ids = ids.filter(id => group.session_ids && group.session_ids.includes(id));
    }
  }

  emptyMessage.style.display = ids.length === 0 ? 'block' : 'none';

  // Count active
  const allIds = Object.keys(sessions);
  const active = allIds.filter(id => !['completed'].includes(sessions[id].status));
  activeCount.textContent = `${active.length} active / ${allIds.length} total`;

  // Remove stale cards
  const visibleSet = new Set(ids);
  for (const card of sessionsContainer.querySelectorAll('.session-card')) {
    if (!visibleSet.has(card.dataset.sessionId)) {
      card.remove();
    }
  }

  // toggledSessions のクリーンアップ（存在しないセッションIDを除去）
  toggledSessions.forEach(id => {
    if (!sessions[id]) toggledSessions.delete(id);
  });

  // Sort: ステータス優先順位（第1キー）+ updated_at 降順（第2キー）の複合ソート
  const priority = { waiting_permission: 0, waiting_answer: 1, error: 2 };
  const sorted = ids.sort((a, b) => {
    const pa = priority[sessions[a].status] ?? 9;
    const pb = priority[sessions[b].status] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(sessions[b].updated_at).getTime() - new Date(sessions[a].updated_at).getTime();
  });

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
  bindRecoverButtons();
  bindToggleCollapse();
  bindGroupDropdowns();
  bindSendKeysButtons();
  bindCopyPathButtons();
  bindCloseSessionButtons();

  // textarea入力値を復元
  Object.entries(savedTexts).forEach(([sid, val]) => {
    const ta = document.querySelector(`.send-keys-textarea[data-session-id="${sid}"]`);
    if (ta) ta.value = val;
  });
}

function renderCard(session) {
  const shortId = session.session_id.substring(0, 8);
  const cwd = session.cwd ? session.cwd.split('/').pop() : '-';
  const updatedAt = new Date(session.updated_at).toLocaleTimeString('ja-JP');
  const statusLabel = STATUS_LABELS[session.status] || session.status;
  const titleDisplay = session.title ? escapeHtml(truncate(session.title, 60)) : `${shortId}...`;
  const collapsed = isCollapsed(session);

  // グループ選択ドロップダウン用
  const currentGroupId = getSessionGroupId(session.session_id);

  const closeBtn = (session.tmux_pane && session.status !== 'completed')
    ? `<button class="btn-close-session" data-session-id="${escapeHtml(session.session_id)}" title="セッションを終了">×</button>`
    : '';

  let html = `
    <div class="card-header clickable" data-toggle-session="${escapeHtml(session.session_id)}">
      <div class="card-title-row">
        <span class="session-title">${titleDisplay}</span>
        <span class="session-id">${shortId}</span>
      </div>
      <div class="card-header-actions">
        <span class="status-badge badge-${session.status}">${statusLabel}</span>
        ${closeBtn}
      </div>
    </div>
  `;

  if (collapsed) {
    return html;
  }

  html += `
    <div class="card-body">
      <div class="card-info">
        <div><span class="label">CWD:</span>${escapeHtml(cwd)}</div>
        ${session.model ? `<div><span class="label">Model:</span>${escapeHtml(session.model)}</div>` : ''}
        <div><span class="label">更新:</span>${updatedAt}</div>
      </div>
  `;

  // グループ選択ドロップダウン
  html += renderGroupDropdown(session.session_id, currentGroupId);

  if (session.status_text) {
    html += `<div class="status-text">${escapeHtml(session.status_text)}</div>`;
  }

  // 直近アクティビティ
  const activityText = session.last_activity || session.last_message;
  if (activityText) {
    html += `<div class="last-activity">${escapeHtml(truncate(activityText, 200))}</div>`;
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
  // 復帰ボタンはステータス基準で表示（decision未到着タイミングでも表示される）
  if (session.status === 'waiting_permission') {
    html += `<button class="btn-recover" data-session-id="${escapeHtml(session.session_id)}">↩ 復帰</button>`;
  }

  // Question panel
  if (session.status === 'waiting_answer' && session.questions && session.questions.length > 0) {
    html += renderQuestionPanel(session.questions, session.session_id);
  } else if (session.status === 'waiting_answer') {
    html += `
      <div class="question-panel">
        <h4>質問発生</h4>
        <p class="terminal-notice">ターミナルで質問内容を確認してください</p>
        <button class="btn-recover" data-session-id="${escapeHtml(session.session_id)}">↩ 復帰</button>
      </div>
    `;
  }

  // Error panel
  if (session.status === 'error') {
    html += renderErrorPanel(session);
  }

  // Send Keys パネル（idle状態のみ）
  if (session.status === 'idle') {
    if (session.tmux_pane) {
      const templateList = Object.values(promptTemplates);
      let templateOptions = `<option value="">-- テンプレート選択 --</option>`;
      templateList.forEach(t => {
        templateOptions += `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`;
      });

      html += `
        <div class="send-keys-panel" data-session-id="${escapeHtml(session.session_id)}">
          <div class="send-keys-header">
            <span>プロンプト入力</span>
            <div class="send-keys-header-actions">
              <button class="btn-history" data-session-id="${escapeHtml(session.session_id)}" title="送信履歴">&#128336;</button>
              <select class="template-select" data-session-id="${escapeHtml(session.session_id)}">
                ${templateOptions}
              </select>
              <button class="btn-template-manage" data-session-id="${escapeHtml(session.session_id)}" title="テンプレート管理">&#9881;</button>
            </div>
          </div>
          <div class="prompt-history-popup" data-session-id="${escapeHtml(session.session_id)}" style="display:none;"></div>
          <div class="template-manage-panel" data-session-id="${escapeHtml(session.session_id)}" style="display:none;"></div>
          <div class="send-keys-input-row">
            <textarea class="send-keys-textarea" data-session-id="${escapeHtml(session.session_id)}"
                      placeholder="プロンプトを入力（改行はスペースに変換されます）" rows="2"></textarea>
            <button class="btn-send-keys" data-session-id="${escapeHtml(session.session_id)}">送信</button>
          </div>
          <div class="send-keys-footer">
            <button class="btn-save-template" data-session-id="${escapeHtml(session.session_id)}">テンプレートとして保存</button>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="send-keys-panel disabled">
          <span class="tmux-not-connected">tmux接続なし — セッションをtmux内で起動してください</span>
        </div>
      `;
    }
  }

  // 成果物一覧
  if (session.artifacts && session.artifacts.length > 0) {
    html += renderArtifactsPanel(session.artifacts, session.cwd);
  }

  // Milestones
  if (session.milestones && session.milestones.length > 0) {
    html += `<div class="milestones">`;
    session.milestones.slice(-3).forEach(m => {
      html += `<div class="milestone-item">🏁 ${escapeHtml(m.milestone)}${m.details ? ` - ${escapeHtml(m.details)}` : ''}</div>`;
    });
    html += `</div>`;
  }

  // Activities
  html += renderActivitiesPanel(session.activities);

  html += `</div>`; // .card-body

  return html;
}

function toRelativePath(absolutePath, cwd) {
  if (!cwd || !absolutePath.startsWith(cwd)) return absolutePath;
  const rel = absolutePath.slice(cwd.length);
  return rel.startsWith('/') ? rel.slice(1) : rel;
}

function renderActivitiesPanel(activities) {
  if (!activities || activities.length === 0) return '';
  let html = `<details class="activities-panel"><summary>やり取り履歴 (${activities.length})</summary>`;
  html += `<div class="activities-list">`;
  // 新しい順に表示
  [...activities].reverse().forEach(a => {
    const time = new Date(a.timestamp).toLocaleTimeString('ja-JP');
    const icon = { prompt: '\u{1F4AC}', tool_use: '\u{1F527}', message: '\u{1F4DD}', milestone: '\u{1F3C1}' }[a.type] || '\u2022';
    html += `<div class="activity-item activity-${a.type}">`;
    html += `<span class="activity-time">${time}</span>`;
    html += `<span class="activity-icon">${icon}</span>`;
    html += `<span class="activity-summary">${escapeHtml(a.summary)}</span>`;
    html += `</div>`;
  });
  html += `</div></details>`;
  return html;
}

function renderArtifactsPanel(artifacts, cwd) {
  let html = `<details class="artifacts-panel"><summary>成果物 (${artifacts.length})</summary><ul class="artifacts-list">`;
  artifacts.forEach(p => {
    const displayPath = toRelativePath(p, cwd);
    html += `<li title="${escapeHtml(p)}"><span class="artifact-path">${escapeHtml(displayPath)}</span><button class="copy-path-btn" data-path="${escapeHtml(displayPath)}" title="パスをコピー">&#128203;</button></li>`;
  });
  html += `</ul></details>`;
  return html;
}

function renderGroupDropdown(sessionId, currentGroupId) {
  const groupList = Object.values(groups);
  let html = `<div class="group-select"><span class="label">Group:</span><select data-session-id="${escapeHtml(sessionId)}" class="group-dropdown">`;
  html += `<option value=""${!currentGroupId ? ' selected' : ''}>未分類</option>`;
  groupList.forEach(g => {
    html += `<option value="${escapeHtml(g.id)}"${currentGroupId === g.id ? ' selected' : ''}>${escapeHtml(g.name)}</option>`;
  });
  html += `<option value="__new__">+ 新規グループ</option>`;
  html += `</select></div>`;
  return html;
}

function getSessionGroupId(sessionId) {
  for (const g of Object.values(groups)) {
    if (g.session_ids && g.session_ids.includes(sessionId)) {
      return g.id;
    }
  }
  return null;
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

function renderQuestionPanel(questions, sessionId) {
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
  html += `<p class="terminal-notice">回答はターミナルで入力してください</p>`;
  html += `<button class="btn-recover" data-session-id="${escapeHtml(sessionId)}">↩ 復帰</button>`;
  html += `</div>`;
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

function bindToggleCollapse() {
  document.querySelectorAll('.card-header[data-toggle-session]').forEach(header => {
    const sessionId = header.dataset.toggleSession;
    if (!sessionId) return;
    header.onclick = () => {
      if (toggledSessions.has(sessionId)) {
        toggledSessions.delete(sessionId);
      } else {
        toggledSessions.add(sessionId);
      }
      renderSessions();
    };
  });
}

function bindGroupDropdowns() {
  document.querySelectorAll('.group-dropdown').forEach(select => {
    select.onchange = async () => {
      const sessionId = select.dataset.sessionId;
      const value = select.value;
      if (value === '__new__') {
        const name = prompt('グループ名を入力:');
        if (!name) {
          renderSessions();
          return;
        }
        try {
          const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          if (!res.ok) {
            console.error('Create group failed:', await res.text());
            renderSessions();
            return;
          }
          const group = await res.json();
          groups[group.id] = group;
          // 新グループにセッションを追加
          await assignSessionToGroup(sessionId, group.id);
          renderSidebar();
          renderSessions();
        } catch (e) {
          console.error('Create group error:', e);
        }
      } else if (value === '') {
        // 現在のグループから削除
        const currentGroupId = getSessionGroupId(sessionId);
        if (currentGroupId) {
          await removeSessionFromGroup(sessionId, currentGroupId);
        }
        renderSessions();
      } else {
        // 現在のグループから削除してから新グループに追加
        const currentGroupId = getSessionGroupId(sessionId);
        if (currentGroupId) {
          await removeSessionFromGroup(sessionId, currentGroupId);
        }
        await assignSessionToGroup(sessionId, value);
        renderSessions();
      }
    };
  });
}

async function assignSessionToGroup(sessionId, groupId) {
  try {
    const res = await fetch(`/api/groups/${groupId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, action: 'add' }),
    });
    if (res.ok) {
      const group = await res.json();
      groups[group.id] = group;
      renderSidebar();
    } else {
      console.error('Assign session failed:', await res.text());
    }
  } catch (e) {
    console.error('Assign session error:', e);
  }
}

async function removeSessionFromGroup(sessionId, groupId) {
  try {
    const res = await fetch(`/api/groups/${groupId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, action: 'remove' }),
    });
    if (res.ok) {
      const group = await res.json();
      groups[group.id] = group;
      renderSidebar();
    } else {
      console.error('Remove session failed:', await res.text());
    }
  } catch (e) {
    console.error('Remove session error:', e);
  }
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

async function recoverSession(sessionId) {
  const session = sessions[sessionId];
  if (session && session.status === 'waiting_permission') {
    if (!confirm('承認待ちの操作が拒否されます。復帰しますか？')) return;
  } else if (session && session.status === 'waiting_answer') {
    if (!confirm('質問待ち状態を強制的に解除します。ターミナル側の質問は残る場合があります。復帰しますか？')) return;
  }
  try {
    const res = await fetch(`/api/sessions/${sessionId}/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.error('Recover session failed:', await res.text());
    }
  } catch (e) {
    console.error('Recover session error:', e);
  }
}

function bindRecoverButtons() {
  document.querySelectorAll('.btn-recover').forEach(btn => {
    btn.onclick = () => recoverSession(btn.dataset.sessionId);
  });
}

function bindSendKeysButtons() {
  // 送信ボタン
  document.querySelectorAll('.btn-send-keys').forEach(btn => {
    btn.onclick = () => {
      const sessionId = btn.dataset.sessionId;
      const textarea = document.querySelector(`.send-keys-textarea[data-session-id="${sessionId}"]`);
      if (textarea && textarea.value.trim()) {
        sendKeys(sessionId, textarea.value);
      }
    };
  });

  // Ctrl+Enter で送信
  document.querySelectorAll('.send-keys-textarea').forEach(textarea => {
    textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const sessionId = textarea.dataset.sessionId;
        if (textarea.value.trim()) {
          sendKeys(sessionId, textarea.value);
        }
      }
    };
  });

  // テンプレート選択ドロップダウン
  document.querySelectorAll('.template-select').forEach(select => {
    select.onchange = () => {
      const sessionId = select.dataset.sessionId;
      const templateId = select.value;
      if (!templateId) return;
      const template = promptTemplates[templateId];
      if (!template) return;
      const textarea = document.querySelector(`.send-keys-textarea[data-session-id="${sessionId}"]`);
      if (textarea) textarea.value = template.body;
      select.value = ''; // リセット
    };
  });

  // テンプレートとして保存
  document.querySelectorAll('.btn-save-template').forEach(btn => {
    btn.onclick = async () => {
      const sessionId = btn.dataset.sessionId;
      const textarea = document.querySelector(`.send-keys-textarea[data-session-id="${sessionId}"]`);
      if (!textarea || !textarea.value.trim()) {
        return;
      }
      const name = prompt('テンプレート名を入力:');
      if (!name) return;
      try {
        const res = await fetch('/api/prompt-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, body: textarea.value }),
        });
        if (res.ok) {
          const template = await res.json();
          promptTemplates[template.id] = template;
          addLogEntry('template-save', '', `テンプレート「${name}」を保存しました`);
          renderSessions();
        } else {
          const data = await res.json().catch(() => ({}));
          addLogEntry('template-error', '', data.error || '保存に失敗しました');
        }
      } catch (e) {
        console.error('Save template error:', e);
      }
    };
  });

  // テンプレート管理ボタン
  document.querySelectorAll('.btn-template-manage').forEach(btn => {
    btn.onclick = () => {
      const sessionId = btn.dataset.sessionId;
      const panel = document.querySelector(`.template-manage-panel[data-session-id="${sessionId}"]`);
      if (!panel) return;
      if (panel.style.display !== 'none') {
        panel.style.display = 'none';
        return;
      }
      renderTemplateManagePanel(panel);
      panel.style.display = 'block';
    };
  });

  // 履歴ボタン
  document.querySelectorAll('.btn-history').forEach(btn => {
    btn.onclick = () => {
      const sessionId = btn.dataset.sessionId;
      const popup = document.querySelector(`.prompt-history-popup[data-session-id="${sessionId}"]`);
      if (!popup) return;
      if (popup.style.display !== 'none') {
        popup.style.display = 'none';
        return;
      }
      renderHistoryPopup(popup, sessionId);
      popup.style.display = 'block';
    };
  });
}

function renderTemplateManagePanel(panel) {
  const templateList = Object.values(promptTemplates);
  if (templateList.length === 0) {
    panel.innerHTML = '<div class="template-manage-empty">テンプレートなし</div>';
    return;
  }
  let html = '<div class="template-manage-list">';
  templateList.forEach(t => {
    html += `
      <div class="template-manage-item" data-template-id="${escapeHtml(t.id)}">
        <div class="template-manage-info">
          <span class="template-manage-name">${escapeHtml(t.name)}</span>
          <span class="template-manage-body">${escapeHtml(truncate(t.body, 50))}</span>
        </div>
        <div class="template-manage-actions">
          <button class="btn-template-edit" data-template-id="${escapeHtml(t.id)}" title="編集">&#9998;</button>
          <button class="btn-template-delete" data-template-id="${escapeHtml(t.id)}" title="削除">&#128465;</button>
        </div>
        <div class="template-edit-form" data-template-id="${escapeHtml(t.id)}" style="display:none;">
          <input type="text" class="template-edit-name" value="${escapeHtml(t.name)}" placeholder="テンプレート名" />
          <textarea class="template-edit-body" rows="4" placeholder="テンプレート本文">${escapeHtml(t.body)}</textarea>
          <div class="template-edit-buttons">
            <button class="btn-template-save" data-template-id="${escapeHtml(t.id)}">保存</button>
            <button class="btn-template-cancel" data-template-id="${escapeHtml(t.id)}">キャンセル</button>
          </div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  panel.innerHTML = html;

  // 編集ボタン（インライン編集フォームの表示切替）
  panel.querySelectorAll('.btn-template-edit').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.templateId;
      const form = panel.querySelector(`.template-edit-form[data-template-id="${id}"]`);
      if (!form) return;
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    };
  });

  // 保存ボタン
  panel.querySelectorAll('.btn-template-save').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.templateId;
      const form = panel.querySelector(`.template-edit-form[data-template-id="${id}"]`);
      if (!form) return;
      const newName = form.querySelector('.template-edit-name').value;
      const newBody = form.querySelector('.template-edit-body').value;
      try {
        const res = await fetch(`/api/prompt-templates/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName, body: newBody }),
        });
        if (res.ok) {
          const updated = await res.json();
          promptTemplates[updated.id] = updated;
          renderTemplateManagePanel(panel);
          renderSessions();
        }
      } catch (e) {
        console.error('Edit template error:', e);
      }
    };
  });

  // キャンセルボタン
  panel.querySelectorAll('.btn-template-cancel').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.templateId;
      const form = panel.querySelector(`.template-edit-form[data-template-id="${id}"]`);
      if (form) form.style.display = 'none';
    };
  });

  // 削除ボタン
  panel.querySelectorAll('.btn-template-delete').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.templateId;
      const template = promptTemplates[id];
      if (!template) return;
      if (!confirm(`テンプレート「${template.name}」を削除しますか？`)) return;
      try {
        const res = await fetch(`/api/prompt-templates/${id}`, { method: 'DELETE' });
        if (res.ok) {
          delete promptTemplates[id];
          renderTemplateManagePanel(panel);
          renderSessions();
        }
      } catch (e) {
        console.error('Delete template error:', e);
      }
    };
  });
}

function getHistoryKeyForSession(sessionId) {
  const groupId = getSessionGroupId(sessionId);
  return groupId ? `group:${groupId}` : `session:${sessionId}`;
}

function renderHistoryPopup(popup, sessionId) {
  const key = getHistoryKeyForSession(sessionId);
  const history = promptHistories[key] || [];
  if (history.length === 0) {
    popup.innerHTML = '<div class="history-empty">履歴なし</div>';
    return;
  }
  let html = '<div class="history-list">';
  // 最新順で表示
  [...history].reverse().forEach((text, idx) => {
    html += `<div class="history-item" data-history-index="${history.length - 1 - idx}">${escapeHtml(truncate(text, 50))}</div>`;
  });
  html += '</div>';
  popup.innerHTML = html;

  // クリックでテキストエリアに入力
  popup.querySelectorAll('.history-item').forEach(item => {
    item.onclick = () => {
      const index = parseInt(item.dataset.historyIndex, 10);
      const fullText = history[index];
      const textarea = document.querySelector(`.send-keys-textarea[data-session-id="${sessionId}"]`);
      if (textarea && fullText) textarea.value = fullText;
      popup.style.display = 'none';
    };
  });
}

function bindCopyPathButtons() {
  document.querySelectorAll('.copy-path-btn').forEach(btn => {
    btn.onclick = async () => {
      const path = btn.dataset.path;
      try {
        await navigator.clipboard.writeText(path);
        btn.textContent = '\u2713';
        setTimeout(() => { btn.innerHTML = '&#128203;'; }, 1500);
      } catch {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = path;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '\u2713';
        setTimeout(() => { btn.innerHTML = '&#128203;'; }, 1500);
      }
    };
  });
}

function bindCloseSessionButtons() {
  document.querySelectorAll('.btn-close-session').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      closeSession(btn.dataset.sessionId);
    };
  });
}

async function closeSession(sessionId) {
  if (!confirm('このセッションを終了しますか？\ntmuxペインが閉じられます。')) return;
  try {
    const res = await fetch(`/api/sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      addLogEntry('close', sessionId, 'セッションを終了しました');
    } else {
      const data = await res.json().catch(() => ({}));
      addLogEntry('close-error', sessionId, data.error || 'エラー');
    }
  } catch (e) {
    console.error('Close session error:', e);
    addLogEntry('close-error', sessionId, '通信エラー');
  }
}

async function sendKeys(sessionId, text) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/send-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      // 送信成功: テキストエリアをクリア
      const textarea = document.querySelector(`.send-keys-textarea[data-session-id="${sessionId}"]`);
      if (textarea) textarea.value = '';
      addLogEntry('send-keys', sessionId, truncate(text, 40));
    } else {
      const data = await res.json();
      console.error('send-keys failed:', data.error);
      if (res.status === 403) {
        addLogEntry('send-keys-error', sessionId, 'セッションがidle状態ではありません');
      } else {
        addLogEntry('send-keys-error', sessionId, data.error || 'エラー');
      }
    }
  } catch (e) {
    console.error('send-keys error:', e);
    addLogEntry('send-keys-error', sessionId, '通信エラー');
  }
}

async function fetchInitialState() {
  try {
    const [sessRes, decRes, groupRes, templatesRes /* fetchTools: side-effect only */] = await Promise.all([
      fetch('/api/sessions'),
      fetch('/api/decisions/pending'),
      fetch('/api/groups'),
      fetch('/api/prompt-templates'),
      fetchTools(),
    ]);
    const sessList = await sessRes.json();
    const decList = await decRes.json();
    const groupList = await groupRes.json();
    const templatesList = await templatesRes.json();
    sessions = {};
    sessList.forEach(s => { sessions[s.session_id] = s; });
    pendingDecisions = {};
    decList.forEach(d => { pendingDecisions[d.id] = d; });
    groups = {};
    groupList.forEach(g => { groups[g.id] = g; });
    promptTemplates = {};
    templatesList.forEach(t => { promptTemplates[t.id] = t; });

    // プロンプト履歴をprefetch（可視セッションのグループ/セッション単位）
    promptHistories = {};
    const historyKeysToFetch = new Set();
    sessList.forEach(s => {
      const groupId = getSessionGroupId(s.session_id);
      if (groupId) {
        historyKeysToFetch.add(`group:${groupId}`);
      } else {
        historyKeysToFetch.add(`session:${s.session_id}`);
      }
    });
    const historyFetches = Array.from(historyKeysToFetch).map(async (key) => {
      const [type, id] = key.split(':', 2);
      try {
        const res = await fetch(`/api/prompt-history/${type}/${id}`);
        if (res.ok) {
          promptHistories[key] = await res.json();
        }
      } catch (e) {
        console.error('Failed to fetch prompt history:', key, e);
      }
    });
    await Promise.all(historyFetches);

    renderSidebar();
    renderSessions();
  } catch (e) {
    console.error('Failed to fetch initial state:', e);
  }
}


// --- Sidebar ---
function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const groupList = Object.values(groups);

  let html = `
    <div class="sidebar-item${selectedGroupId === null ? ' active' : ''}" data-group-filter="">すべて</div>
    <div class="sidebar-item${selectedGroupId === 'ungrouped' ? ' active' : ''}" data-group-filter="ungrouped">未分類</div>
  `;

  groupList.forEach(g => {
    const count = g.session_ids ? g.session_ids.length : 0;
    html += `
      <div class="sidebar-item${selectedGroupId === g.id ? ' active' : ''}" data-group-filter="${escapeHtml(g.id)}">
        <span class="group-name">${escapeHtml(g.name)}</span>
        <span class="group-count">${count}</span>
        <button class="btn-delete-group" data-group-id="${escapeHtml(g.id)}" title="削除">×</button>
      </div>
    `;
  });

  sidebar.innerHTML = html;

  // バインド
  sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.onclick = (e) => {
      if (e.target.classList.contains('btn-delete-group')) return;
      const filter = item.dataset.groupFilter;
      selectedGroupId = filter === '' ? null : filter;
      renderSidebar();
      renderSessions();
    };
  });

  sidebar.querySelectorAll('.btn-delete-group').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const groupId = btn.dataset.groupId;
      if (!confirm('グループを削除しますか？')) return;
      try {
        const res = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
        if (!res.ok) {
          console.error('Delete group failed:', await res.text());
          return;
        }
        delete groups[groupId];
        if (selectedGroupId === groupId) selectedGroupId = null;
        renderSidebar();
        renderSessions();
      } catch (e) {
        console.error('Delete group error:', e);
      }
    };
  });
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

      // status変更時はトグル状態をリセットしてデフォルト表示に戻す
      if (prev && prev.status !== session.status) {
        toggledSessions.delete(session.session_id);
      }

      // Sound + notification on state transitions
      if (!prev || prev.status !== session.status) {
        if (session.status === 'waiting_permission') {
          playPermissionSound();
          sendDesktopNotification('承認待ち', `${session.session_id.substring(0, 8)}: 承認が必要です`);
        } else if (session.status === 'waiting_answer') {
          playQuestionSound();
          const qText = session.questions?.[0]?.question || '質問が発生しました';
          sendDesktopNotification('質問', qText);
        } else if (session.status === 'idle') {
          playIdleSound();
          sendDesktopNotification('入力待ち', `セッション ${session.session_id.substring(0, 8)} が入力待ちです`);
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
      addLogEntry('decision_resolved', decision.session_id, `${decision.tool_name} → ${decision.result || 'cancelled'}`);
      renderSessions();
      break;
    }

    case 'notification': {
      addLogEntry('notification', payload.session_id, payload.message || payload.notification_type);
      break;
    }

    case 'group_update': {
      const group = payload;
      groups[group.id] = group;
      addLogEntry('group_update', '', group.name);
      // グループの履歴を再取得
      fetch(`/api/prompt-history/group/${group.id}`)
        .then(r => r.ok ? r.json() : [])
        .then(history => { promptHistories[`group:${group.id}`] = history; })
        .catch(() => {});
      renderSidebar();
      renderSessions();
      break;
    }

    case 'group_delete': {
      const { id: deletedId } = payload;
      delete groups[deletedId];
      delete promptHistories[`group:${deletedId}`];
      if (selectedGroupId === deletedId) selectedGroupId = null;
      addLogEntry('group_delete', '', deletedId.substring(0, 8));
      renderSidebar();
      renderSessions();
      break;
    }

    case 'prompt_template_update': {
      promptTemplates[payload.id] = payload;
      renderSessions();
      break;
    }

    case 'prompt_template_delete': {
      delete promptTemplates[payload.id];
      renderSessions();
      break;
    }

    case 'prompt_history_update': {
      const histKey = `${payload.scope}:${payload.id}`;
      promptHistories[histKey] = payload.history;
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

// --- ポップアップ外クリック/Escで閉じる ---
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  // 履歴ポップアップ
  document.querySelectorAll('.prompt-history-popup').forEach(popup => {
    if (popup.style.display !== 'none' && !popup.contains(target) && !target?.classList.contains('btn-history')) {
      popup.style.display = 'none';
    }
  });
  // テンプレート管理パネル
  document.querySelectorAll('.template-manage-panel').forEach(panel => {
    if (panel.style.display !== 'none' && !panel.contains(target) && !target?.classList.contains('btn-template-manage')) {
      panel.style.display = 'none';
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.prompt-history-popup').forEach(popup => {
      popup.style.display = 'none';
    });
    document.querySelectorAll('.template-manage-panel').forEach(panel => {
      panel.style.display = 'none';
    });
  }
});

// --- Init ---
connectWebSocket();
