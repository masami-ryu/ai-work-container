"""Slack Block Kit メッセージ構築"""

from __future__ import annotations

from typing import Any

RISK_LEVELS: dict[str, tuple[str, str]] = {
    "Bash": ("exec", ":warning:"),
    "Write": ("write", ":warning:"),
    "Edit": ("write", ":large_blue_circle:"),
    "WebFetch": ("network", ":large_blue_circle:"),
}


def _risk_text(tool_name: str) -> str:
    category, emoji = RISK_LEVELS.get(tool_name, ("other", ":white_circle:"))
    return f"{emoji} {category}"


def _command_summary(tool_name: str, input_data: dict[str, Any]) -> str:
    if tool_name == "Bash":
        return input_data.get("command", "(no command)")
    if tool_name == "Write":
        return input_data.get("file_path", "(no path)")
    if tool_name == "Edit":
        path = input_data.get("file_path", "")
        old = (input_data.get("old_string") or "")[:80]
        return f"{path}\n{old}..."
    return str(input_data)[:200]


# --- 権限確認メッセージ ---


def permission_blocks(
    tool_name: str,
    input_data: dict[str, Any],
    correlation_id: str,
    timeout_sec: int,
) -> list[dict]:
    summary = _command_summary(tool_name, input_data)
    return [
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
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"```\n{summary}\n```"},
        },
        {
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
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Timeout: {timeout_sec // 60}min → auto-deny",
                }
            ],
        },
    ]


def permission_resolved_blocks(
    tool_name: str, decision: str, user_id: str
) -> list[dict]:
    emoji = ":white_check_mark:" if decision == "allow" else ":x:"
    return [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{emoji} *{tool_name}* → *{decision.upper()}* by <@{user_id}>",
            },
        },
    ]


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
    header_text = "Question (select multiple)" if multi_select else "Question"
    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": header_text},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*{header}:* {question_text}"},
        },
    ]

    buttons: list[dict] = []
    for i, opt in enumerate(options):
        label = opt["label"]
        desc = opt.get("description", "")
        display = f"{'✅ ' if label in selected else ''}{label}"
        action_id = "ask_toggle" if multi_select else "ask_choice"
        btn: dict[str, Any] = {
            "type": "button",
            "text": {"type": "plain_text", "text": display},
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

    blocks.append({"type": "actions", "elements": buttons})
    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": ":speech_balloon: Other: reply in thread with your answer",
                }
            ],
        },
    )
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
