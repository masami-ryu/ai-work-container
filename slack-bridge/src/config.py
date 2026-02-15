"""環境変数・設定管理"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    slack_app_token: str
    slack_bot_token: str
    slack_channel: str
    slack_approver_user_id: str
    permission_timeout_sec: int = 300
    ask_question_timeout_sec: int = 300
    fallback_stdin: bool = False


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"ERROR: 環境変数 {name} が未設定です", file=sys.stderr)
        sys.exit(1)
    return value


def load_config(argv: list[str] | None = None) -> Config:
    """環境変数とCLI引数から設定を読み込む。.env ファイルがあれば自動読み込み。"""
    # .env ファイルを探索: カレントディレクトリ → スクリプトの親ディレクトリ
    load_dotenv(Path.cwd() / ".env")
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--fallback-stdin", action="store_true", default=False)
    args, _ = parser.parse_known_args(argv)

    return Config(
        slack_app_token=_require_env("SLACK_APP_TOKEN"),
        slack_bot_token=_require_env("SLACK_BOT_TOKEN"),
        slack_channel=_require_env("SLACK_CHANNEL"),
        slack_approver_user_id=_require_env("SLACK_APPROVER_USER_ID"),
        permission_timeout_sec=int(os.environ.get("PERMISSION_TIMEOUT_SEC", "300")),
        ask_question_timeout_sec=int(os.environ.get("ASK_QUESTION_TIMEOUT_SEC", "300")),
        fallback_stdin=args.fallback_stdin,
    )
