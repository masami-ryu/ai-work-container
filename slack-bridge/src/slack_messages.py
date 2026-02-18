"""Slack Block Kit メッセージ構築"""

from __future__ import annotations

import os
import re
from typing import Any

# Block Kit section text の文字数上限
BLOCK_TEXT_MAX_CHARS = 3000

# コマンドサマリの文字数上限
COMMAND_SUMMARY_MAX_CHARS = 2500

# Write ツールの内容プレビュー文字数
WRITE_CONTENT_PREVIEW_CHARS = 500

# 秘匿情報のマスキングパターン
_SECRET_PATTERNS = re.compile(
    r"""(?x)
    # token= / password= / key= / secret= の後の値
    (?:token|password|passwd|key|secret|api_key|apikey|access_token|auth)
    \s*[=:]\s*
    (['"]?)(\S+?)\1
    |
    # Bearer トークン
    Bearer\s+\S+
    |
    # AWS アクセスキー風
    (?:AKIA|ASIA)[A-Z0-9]{16}
    |
    # 一般的なトークンパターン (xoxb-, xoxp-, xapp-, sk-, ghp_, gho_, ghs_)
    (?:xox[bpa]-|sk-|ghp_|gho_|ghs_)\S+
    """,
    re.IGNORECASE,
)

# 機密ファイルパターン
_SENSITIVE_FILE_PATTERNS = re.compile(
    r"""(?x)
    \.env(?:\..+)?$
    | credentials\.\w+$
    | \.pem$
    | \.key$
    | \.secret$
    | id_rsa
    | id_ed25519
    """,
    re.IGNORECASE,
)

RISK_LEVELS: dict[str, tuple[str, str]] = {
    "Bash": ("exec", ":warning:"),
    "Write": ("write", ":warning:"),
    "Edit": ("write", ":large_blue_circle:"),
    "WebFetch": ("network", ":large_blue_circle:"),
}


def _risk_text(tool_name: str) -> str:
    category, emoji = RISK_LEVELS.get(tool_name, ("other", ":white_circle:"))
    return f"{emoji} {category}"


def _mask_secrets(text: str) -> str:
    """秘匿情報をマスキングする。"""
    return _SECRET_PATTERNS.sub("***", text)


def _is_sensitive_file(file_path: str) -> bool:
    """機密ファイルかどうかを判定する。"""
    return bool(_SENSITIVE_FILE_PATTERNS.search(file_path))


def _truncate(text: str, max_chars: int, suffix: str = "\n... (truncated)") -> tuple[str, bool]:
    """テキストを最大文字数で切り捨てる。(切り捨て後テキスト, 切り捨てたか) を返す。"""
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars - len(suffix)] + suffix, True


def _safe_block_text(text: str) -> str:
    """Block Kit section text の文字数制限をバリデーションする。"""
    truncated, was_truncated = _truncate(text, BLOCK_TEXT_MAX_CHARS)
    return truncated


def _command_summary(tool_name: str, input_data: dict[str, Any]) -> dict[str, Any]:
    """ツール実行のリッチサマリを生成する。

    Returns:
        dict with keys:
        - tool: ツール名
        - description: 説明テキスト
        - scope: 影響範囲
        - truncated: 切り捨てが発生したか
    """
    result: dict[str, Any] = {
        "tool": tool_name,
        "description": "",
        "scope": "",
        "truncated": False,
    }

    if tool_name == "Bash":
        command = input_data.get("command", "(no command)")
        masked = _mask_secrets(command)
        desc, truncated = _truncate(masked, COMMAND_SUMMARY_MAX_CHARS)
        result["description"] = desc
        result["truncated"] = truncated
        # cwd がある場合はスコープとして表示
        cwd = input_data.get("cwd") or input_data.get("working_directory")
        if cwd:
            result["scope"] = cwd

    elif tool_name == "Write":
        file_path = input_data.get("file_path", "(no path)")
        result["scope"] = os.path.dirname(file_path) or "."
        if _is_sensitive_file(file_path):
            result["description"] = f"[File: {file_path}]\n(content hidden - sensitive file)"
        else:
            content = input_data.get("content", "")
            masked = _mask_secrets(content)
            preview, truncated = _truncate(masked, WRITE_CONTENT_PREVIEW_CHARS)
            result["description"] = f"[File: {file_path}]\n{preview}"
            result["truncated"] = truncated
        # 新規ファイル vs 既存ファイル (file_path の存在チェックはできないが情報は表示)
        result["is_new_file"] = True  # Write は基本的に新規/上書き

    elif tool_name == "Edit":
        file_path = input_data.get("file_path", "(no path)")
        result["scope"] = os.path.dirname(file_path) or "."
        if _is_sensitive_file(file_path):
            result["description"] = f"[File: {file_path}]\n(content hidden - sensitive file)"
        else:
            old = _mask_secrets(input_data.get("old_string") or "")
            new = _mask_secrets(input_data.get("new_string") or "")
            diff_lines = []
            diff_lines.append(f"[File: {file_path}]")
            for line in old.splitlines():
                diff_lines.append(f"- {line}")
            for line in new.splitlines():
                diff_lines.append(f"+ {line}")
            diff_text = "\n".join(diff_lines)
            desc, truncated = _truncate(diff_text, COMMAND_SUMMARY_MAX_CHARS)
            result["description"] = desc
            result["truncated"] = truncated
        result["is_new_file"] = False

    elif tool_name == "NotebookEdit":
        notebook_path = input_data.get("notebook_path", "(no path)")
        result["scope"] = os.path.dirname(notebook_path) or "."
        result["description"] = f"[Notebook: {notebook_path}]"

    else:
        data_str = _mask_secrets(str(input_data))
        desc, truncated = _truncate(data_str, COMMAND_SUMMARY_MAX_CHARS)
        result["description"] = desc
        result["truncated"] = truncated

    return result


# --- 権限確認メッセージ ---


def permission_blocks(
    tool_name: str,
    input_data: dict[str, Any],
    correlation_id: str,
    timeout_sec: int,
) -> list[dict]:
    summary = _command_summary(tool_name, input_data)
    description_text = input_data.get("description", "")

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "Permission Required"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Tool:*\n{tool_name}"},
                {"type": "mrkdwn", "text": f"*Risk:*\n{_risk_text(tool_name)}"},
            ],
        },
    ]

    # TASK-202: 実行意図（description）がある場合は表示
    if description_text:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Why:* {_safe_block_text(description_text)}"},
        })

    # TASK-203: 影響範囲
    scope = summary.get("scope", "")
    if scope:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Scope:* `{scope}`"},
        })

    # TASK-201: リッチなコマンドサマリ
    summary_text = summary["description"]
    truncated_indicator = " ⚠️ _truncated_" if summary.get("truncated") else ""
    code_block = _safe_block_text(f"```\n{summary_text}\n```{truncated_indicator}")
    blocks.append({
        "type": "section",
        "text": {"type": "mrkdwn", "text": code_block},
    })

    # Allow/Deny ボタン
    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Allow"},
                "style": "primary",
                "action_id": "perm_allow",
                "value": correlation_id,
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Deny"},
                "style": "danger",
                "action_id": "perm_deny",
                "value": correlation_id,
            },
        ],
    })

    # タイムアウト表示
    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": f"Timeout: {timeout_sec // 60}min → auto-deny",
            }
        ],
    })

    return blocks


def permission_resolved_blocks(
    tool_name: str,
    decision: str,
    user_id: str,
    summary_text: str | None = None,
) -> list[dict]:
    """TASK-404: resolved メッセージにコマンドサマリを残す。"""
    emoji = ":white_check_mark:" if decision == "allow" else ":x:"
    blocks: list[dict] = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{emoji} *{tool_name}* → *{decision.upper()}* by <@{user_id}>",
            },
        },
    ]
    if summary_text:
        truncated_summary = _safe_block_text(f"```\n{summary_text}\n```")
        blocks.append({
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": truncated_summary},
            ],
        })
    return blocks


def permission_timeout_blocks(tool_name: str) -> list[dict]:
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f":hourglass: *{tool_name}* → *TIMED OUT* (auto-deny)",
            },
        },
    ]


# --- AskUserQuestion メッセージ ---


def ask_question_blocks(
    question_text: str,
    header: str,
    options: list[dict[str, str]],
    correlation_id: str,
    question_index: int,
    multi_select: bool,
    timeout_sec: int,
    selected_labels: list[str] | None = None,
) -> list[dict]:
    selected = set(selected_labels or [])
    # TASK-402: header ブロックに header 引数を反映
    if header:
        header_display = f"{header} (select multiple)" if multi_select else header
    else:
        header_display = "Question (select multiple)" if multi_select else "Question"

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": header_display[:150]},  # header max 150 chars
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": _safe_block_text(question_text)},
        },
    ]

    buttons: list[dict] = []
    for i, opt in enumerate(options):
        label = opt["label"]
        display = f"{'✅ ' if label in selected else ''}{label}"
        action_id = "ask_toggle" if multi_select else "ask_choice"
        btn: dict[str, Any] = {
            "type": "button",
            "text": {"type": "plain_text", "text": display[:75]},  # button text max 75 chars
            "action_id": f"{action_id}_{question_index}_{i}",
            "value": f"{correlation_id}|{question_index}|{i}",
        }
        buttons.append(btn)

    if multi_select:
        buttons.append(
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "✅ Confirm"},
                "style": "primary",
                "action_id": f"ask_confirm_{question_index}",
                "value": correlation_id,
            }
        )

    # Other ボタンを選択肢ボタンの後に追加
    buttons.append(
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "Other..."},
            "action_id": f"ask_other_{question_index}",
            "value": f"{correlation_id}|{question_index}",
        }
    )

    blocks.append({"type": "actions", "elements": buttons})

    # TASK-401: 選択肢の description 表示
    desc_elements = []
    for opt in options:
        desc = opt.get("description", "")
        label = opt["label"]
        if desc:
            desc_elements.append(
                {"type": "mrkdwn", "text": f"*{label}:* {desc}"}
            )
    if desc_elements:
        blocks.append({
            "type": "context",
            "elements": desc_elements[:10],  # context elements max 10
        })

    # スレッド返信ヒント
    blocks.append({
        "type": "context",
        "elements": [
            {"type": "mrkdwn", "text": "💡 You can also reply in this thread to answer."},
        ],
    })

    return blocks


def ask_resolved_blocks(
    question_text: str, answer: str, user_id: str
) -> list[dict]:
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f":white_check_mark: *{question_text}* → *{answer}* by <@{user_id}>",
            },
        },
    ]


def ask_timeout_blocks(question_text: str) -> list[dict]:
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f":hourglass: *{question_text}* → *TIMED OUT* (auto-cancel)",
            },
        },
    ]


# --- セッションメッセージ ---


def session_start_blocks(
    prompt: str, cwd: str, session_id: str
) -> list[dict]:
    # TASK-403: プロンプト表示を 200 文字に拡大
    prompt_display = prompt[:200] + ("..." if len(prompt) > 200 else "")
    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"Session started: {session_id}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Prompt:*\n{prompt_display}"},
                {"type": "mrkdwn", "text": f"*CWD:*\n`{cwd}`"},
            ],
        },
    ]
    # 全文が 200 文字を超える場合は折りたたみセクションを追加
    if len(prompt) > 200:
        full_prompt = _safe_block_text(prompt)
        blocks.append({
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"_Full prompt:_\n{full_prompt}"},
            ],
        })
    return blocks


def session_end_blocks(
    session_id: str,
    status: str,
    *,
    duration_sec: float | None = None,
    tool_stats: dict[str, Any] | None = None,
    changed_files: list[str] | None = None,
    error_message: str | None = None,
) -> list[dict]:
    """セッション終了メッセージ（TASK-305: リッチサマリ対応）。"""
    if status == "completed":
        emoji = ":white_check_mark:"
        label = "completed"
    elif status == "error":
        emoji = ":x:"
        label = "error"
    else:
        emoji = ":black_square_for_stop:"
        label = status

    blocks: list[dict] = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{emoji} *Session {session_id}* → *{label}*",
            },
        },
    ]

    # リッチサマリ情報
    stats_fields: list[dict] = []

    if duration_sec is not None:
        mins, secs = divmod(int(duration_sec), 60)
        if mins > 0:
            stats_fields.append(
                {"type": "mrkdwn", "text": f"*Duration:*\n{mins}m {secs}s"}
            )
        else:
            stats_fields.append(
                {"type": "mrkdwn", "text": f"*Duration:*\n{secs}s"}
            )

    if tool_stats:
        total = tool_stats.get("total_uses", 0)
        allowed = tool_stats.get("allowed", 0)
        denied = tool_stats.get("denied", 0)
        auto_allowed = tool_stats.get("auto_allowed", 0)
        stats_text = f"Total: {total} (✅ {allowed} / ❌ {denied} / 🤖 {auto_allowed})"
        stats_fields.append(
            {"type": "mrkdwn", "text": f"*Tools:*\n{stats_text}"}
        )

    if stats_fields:
        blocks.append({
            "type": "section",
            "fields": stats_fields[:10],
        })

    if changed_files:
        files_text = "\n".join(f"• `{f}`" for f in changed_files[:20])
        if len(changed_files) > 20:
            files_text += f"\n_... and {len(changed_files) - 20} more_"
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Changed files:*\n{_safe_block_text(files_text)}"},
        })

    if error_message:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Error:*\n```\n{_safe_block_text(error_message)}\n```"},
        })

    return blocks


# --- 進捗通知メッセージ (Phase 3) ---


def todo_progress_blocks(
    todos: list[dict[str, Any]],
    session_id: str,
) -> list[dict]:
    """TodoList 進捗メッセージ (TASK-303)。"""
    if not todos:
        return []

    total = len(todos)
    completed = sum(1 for t in todos if t.get("status") == "completed")
    in_progress = sum(1 for t in todos if t.get("status") == "in_progress")
    pending = total - completed - in_progress

    # プログレスバー
    bar_length = 20
    filled = int(bar_length * completed / total) if total > 0 else 0
    progress_bar = "█" * filled + "░" * (bar_length - filled)
    pct = int(100 * completed / total) if total > 0 else 0

    lines = [f"*Progress:* {progress_bar} {pct}% ({completed}/{total})"]

    for t in todos:
        status = t.get("status", "pending")
        content = t.get("content", "") or t.get("activeForm", "")
        if status == "completed":
            lines.append(f"  ✅ ~{content}~")
        elif status == "in_progress":
            active = t.get("activeForm", content)
            lines.append(f"  🔄 *{active}*")
        else:
            lines.append(f"  ⬜ {content}")

    text = "\n".join(lines)
    return [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": _safe_block_text(text)},
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"Session: {session_id}"},
            ],
        },
    ]


def periodic_progress_blocks(
    session_id: str,
    duration_sec: float,
    tool_uses: int,
    last_tool: str | None = None,
) -> list[dict]:
    """定期進捗ステータスメッセージ (TASK-304)。"""
    mins, secs = divmod(int(duration_sec), 60)
    duration_text = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"

    status_parts = [f"⏱️ Running for {duration_text}", f"🔧 Tools used: {tool_uses}"]
    if last_tool:
        status_parts.append(f"📌 Last: {last_tool}")

    return [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": " | ".join(status_parts)},
        },
    ]


def error_alert_blocks(
    session_id: str,
    error_message: str,
) -> list[dict]:
    """エラーアラートメッセージ (TASK-306)。"""
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"<!channel> :rotating_light: *Error in session {session_id}*\n```\n{_safe_block_text(error_message)}\n```",
            },
        },
    ]


def timeout_warning_blocks(
    session_id: str,
    consecutive_count: int,
) -> list[dict]:
    """連続タイムアウト警告メッセージ (TASK-306)。"""
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"<!channel> :warning: *Session {session_id}*: {consecutive_count} consecutive timeouts detected. The session may need attention.",
            },
        },
    ]


def client_disconnected_blocks(session_id: str) -> list[dict]:
    """TASK-603: CLI クライアント切断通知メッセージ。"""
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f":electric_plug: *Session {session_id}*: CLI connection lost, but the session continues running.",
            },
        },
    ]
