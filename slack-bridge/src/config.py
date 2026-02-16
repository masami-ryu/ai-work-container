"""環境変数・設定管理"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# TASK-602: トークンフォーマットバリデーション
_SLACK_APP_TOKEN_RE = re.compile(r"^xapp-\d+-[A-Za-z0-9]+-\d+-[A-Za-z0-9]+$")
_SLACK_BOT_TOKEN_RE = re.compile(r"^xoxb-\d+-\d+-[A-Za-z0-9]+$")
_SLACK_USER_ID_RE = re.compile(r"^U[A-Z0-9]+$")


class ConfigValidationError(Exception):
    """設定値のバリデーションエラー。"""
    pass


@dataclass(frozen=True)
class Config:
    slack_app_token: str
    slack_bot_token: str
    slack_channel: str
    slack_approver_user_id: str
    permission_timeout_sec: int = 300
    ask_question_timeout_sec: int = 300

    def __post_init__(self) -> None:
        """TASK-602: 設定値のバリデーション。"""
        errors: list[str] = []

        # トークンフォーマット検証
        if not self.slack_app_token.startswith("xapp-"):
            errors.append("SLACK_APP_TOKEN must start with 'xapp-'")

        if not self.slack_bot_token.startswith("xoxb-"):
            errors.append("SLACK_BOT_TOKEN must start with 'xoxb-'")

        # ユーザーID検証
        if not _SLACK_USER_ID_RE.match(self.slack_approver_user_id):
            errors.append(
                f"SLACK_APPROVER_USER_ID '{self.slack_approver_user_id}' "
                "must match pattern U[A-Z0-9]+"
            )

        # チャンネル名検証
        if not self.slack_channel:
            errors.append("SLACK_CHANNEL must not be empty")

        # タイムアウト値検証
        if self.permission_timeout_sec < 30:
            errors.append(
                f"PERMISSION_TIMEOUT_SEC ({self.permission_timeout_sec}) "
                "must be >= 30 seconds"
            )
        if self.permission_timeout_sec > 3600:
            errors.append(
                f"PERMISSION_TIMEOUT_SEC ({self.permission_timeout_sec}) "
                "must be <= 3600 seconds"
            )
        if self.ask_question_timeout_sec < 30:
            errors.append(
                f"ASK_QUESTION_TIMEOUT_SEC ({self.ask_question_timeout_sec}) "
                "must be >= 30 seconds"
            )
        if self.ask_question_timeout_sec > 3600:
            errors.append(
                f"ASK_QUESTION_TIMEOUT_SEC ({self.ask_question_timeout_sec}) "
                "must be <= 3600 seconds"
            )

        if errors:
            raise ConfigValidationError(
                "Config validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
            )


@dataclass(frozen=True)
class ClientConfig:
    socket_path: str


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"ERROR: 環境変数 {name} が未設定です", file=sys.stderr)
        sys.exit(1)
    return value


def _load_dotenv_files() -> None:
    """カレントディレクトリ → パッケージ親 → ~/.config/slack-bridge/.env の順で探索。"""
    load_dotenv(Path.cwd() / ".env")
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    load_dotenv(Path.home() / ".config" / "slack-bridge" / ".env")


def load_config() -> Config:
    """デーモン用: 全秘密情報を必須とする設定を読み込む。"""
    _load_dotenv_files()

    return Config(
        slack_app_token=_require_env("SLACK_APP_TOKEN"),
        slack_bot_token=_require_env("SLACK_BOT_TOKEN"),
        slack_channel=_require_env("SLACK_CHANNEL"),
        slack_approver_user_id=_require_env("SLACK_APPROVER_USER_ID"),
        permission_timeout_sec=int(os.environ.get("PERMISSION_TIMEOUT_SEC", "300")),
        ask_question_timeout_sec=int(os.environ.get("ASK_QUESTION_TIMEOUT_SEC", "300")),
    )


def load_client_config() -> ClientConfig:
    """CLI クライアント用: ソケットパスのみ。Slack 認証情報は不要。"""
    from .ipc import get_socket_path

    return ClientConfig(socket_path=get_socket_path())
