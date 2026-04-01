"""エントリポイント: sb serve / sb run / sb status サブコマンド"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# --- serve サブコマンド ---


async def _serve() -> None:
    """デーモンプロセス: SlackBot + SessionManager + IPC サーバーを起動。"""
    from .config import load_config
    from .bridge import RequestBridge
    from .audit import AuditLog
    from .slack_bot import SlackBot
    from .session import SessionManager
    from .session_store import SessionStore
    from .ipc import IPCServer

    config = load_config()
    bridge = RequestBridge()
    audit = AuditLog()
    session_store = SessionStore()

    shutdown_event = asyncio.Event()
    # P2-005: シャットダウン二重実行防止フラグ
    shutdown_triggered = False

    async def _shutdown():
        nonlocal shutdown_triggered
        if shutdown_triggered:
            logger.debug("Shutdown already triggered, ignoring duplicate")
            return
        shutdown_triggered = True

        logger.info("Shutting down...")
        # 1. IPC を draining にして新規セッションを拒否
        ipc_server.set_draining()
        # 2. SessionManager をシャットダウン（全セッション cancel + await）
        await session_manager.shutdown()
        # 3. IPC サーバーを close
        await ipc_server.close()
        # 4. Slack Bot を停止
        await bot.stop()
        shutdown_event.set()

    # P2-003: 致命的切断時にシャットダウンを実行するコールバック
    bot = SlackBot(
        config=config, bridge=bridge, audit=audit,
        on_fatal_disconnect=_shutdown,
    )
    session_manager = SessionManager(
        bot=bot, bridge=bridge, config=config, audit=audit,
        session_store=session_store,
    )
    bot.set_session_manager(session_manager)
    ipc_server = IPCServer(session_manager=session_manager)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(_shutdown()))

    await bot.start()
    logger.info("Slack Bot started")

    await ipc_server.start()
    logger.info("IPC server started (socket: %s)", ipc_server.socket_path)

    # P5-003: デーモン起動時に前回中断されたセッションを復旧
    recovered = await session_manager.recover_interrupted_sessions()
    if recovered > 0:
        logger.info("Recovered %d interrupted session(s) from previous run", recovered)

    logger.info("Daemon ready. Use '/claude' in Slack to start a session.")

    await shutdown_event.wait()
    logger.info("Daemon stopped")


def _cmd_serve(args: argparse.Namespace) -> None:
    asyncio.run(_serve())


# --- run サブコマンド ---


async def _run(prompt: str, cwd: str | None, tail: int) -> None:
    """IPC 経由でデーモンにセッション起動を要求し、出力をストリーミング表示する。"""
    from .config import load_client_config

    client_config = load_client_config()
    socket_path = client_config.socket_path

    try:
        reader, writer = await asyncio.open_unix_connection(socket_path)
    except (FileNotFoundError, ConnectionRefusedError):
        print(
            f"ERROR: デーモンに接続できません (socket: {socket_path})\n"
            "  'sb serve' でデーモンを起動してください。",
            file=sys.stderr,
        )
        sys.exit(1)

    request = {"action": "start_session", "prompt": prompt, "cwd": cwd}
    writer.write((json.dumps(request) + "\n").encode())
    await writer.drain()

    exit_code = 0
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            event = json.loads(line.decode())
            event_type = event.get("type")

            if event_type == "started":
                session_id = event.get("session_id", "")
                thread_ts = event.get("thread_ts", "")
                print(f"Session {session_id} started (thread: {thread_ts})")

            elif event_type == "output":
                text = event.get("text", "")
                block_type = event.get("block_type", "text")
                # P3-004: block_type に基づくフォーマット表示
                if block_type == "tool_use":
                    # ツール使用: 青色（ANSI 34）
                    print(f"\033[34m{text}\033[0m", end="", flush=True)
                elif block_type == "thinking":
                    # 思考: 灰色（ANSI 90）
                    print(f"\033[90m{text}\033[0m", end="", flush=True)
                elif block_type == "tool_result":
                    # ツール結果: 緑色（ANSI 32）
                    print(f"\033[32m{text}\033[0m", end="", flush=True)
                else:
                    # テキスト: 通常出力
                    print(text, end="", flush=True)

            elif event_type == "error":
                msg = event.get("message", "Unknown error")
                code = event.get("code", 1)
                print(f"\nSession error: {msg}", file=sys.stderr)
                exit_code = code
                break

            elif event_type == "completed":
                print("\nSession completed.")
                break
    finally:
        writer.close()
        await writer.wait_closed()

    sys.exit(exit_code)


def _cmd_run(args: argparse.Namespace) -> None:
    import warnings
    warnings.warn(
        "`sb run` は次版で削除予定です。`/claude` コマンドを使用してください。\n"
        "  Slack チャンネルで `/claude \"プロンプト\"` を実行すると同等の機能が利用できます。\n"
        "  詳細: docs/セットアップガイド.md",
        DeprecationWarning,
        stacklevel=2,
    )
    asyncio.run(_run(args.prompt, args.cwd, args.tail))


# --- status サブコマンド ---


async def _status(include_all: bool = False) -> None:
    """IPC 経由でセッション一覧を取得し表示する。

    P5-005: --all オプションで SQLite から履歴含む全セッションを表示。
    """
    from .config import load_client_config

    client_config = load_client_config()
    socket_path = client_config.socket_path

    try:
        reader, writer = await asyncio.open_unix_connection(socket_path)
    except (FileNotFoundError, ConnectionRefusedError):
        print(
            f"ERROR: デーモンに接続できません (socket: {socket_path})\n"
            "  'sb serve' でデーモンを起動してください。",
            file=sys.stderr,
        )
        sys.exit(1)

    request = {"action": "list_sessions"}
    if include_all:
        request["include_history"] = True
    writer.write((json.dumps(request) + "\n").encode())
    await writer.drain()

    line = await reader.readline()
    writer.close()
    await writer.wait_closed()

    if not line:
        print("No response from daemon.", file=sys.stderr)
        sys.exit(1)

    sessions = json.loads(line.decode())

    if not sessions:
        label = "sessions" if include_all else "active sessions"
        print(f"No {label}.")
        return

    print(f"{'SESSION ID':<12} {'STATUS':<14} {'CWD':<30} PROMPT")
    print("-" * 80)
    for s in sessions:
        prompt_short = s.get("prompt", "")[:40]
        print(
            f"{s.get('session_id', ''):<12} "
            f"{s.get('status', ''):<14} "
            f"{s.get('cwd', ''):<30} "
            f"{prompt_short}"
        )


def _cmd_status(args: argparse.Namespace) -> None:
    asyncio.run(_status(include_all=args.all))


# --- 旧CLI 互換エラー ---

_MIGRATION_MESSAGE = """\
ERROR: 旧CLI形式は廃止されました。以下のサブコマンドを使用してください:

  sb serve              デーモンを起動（常駐）
  sb run "プロンプト"     セッションを追加
  sb status             アクティブセッション一覧

詳細: docs/セットアップガイド.md
"""


# --- メインエントリポイント ---


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="sb",
        description="Slack Bridge for Claude Code",
    )
    subparsers = parser.add_subparsers(dest="command")

    # serve
    serve_parser = subparsers.add_parser("serve", help="デーモンを起動（常駐）")
    serve_parser.set_defaults(func=_cmd_serve)

    # run
    run_parser = subparsers.add_parser("run", help="セッションを追加")
    run_parser.add_argument("prompt", help="初回プロンプト")
    run_parser.add_argument("--cwd", default=None, help="対象プロジェクトのディレクトリ")
    run_parser.add_argument("--tail", type=int, default=100, help="過去バッファから取得する行数")
    run_parser.set_defaults(func=_cmd_run)

    # status
    status_parser = subparsers.add_parser("status", help="アクティブセッション一覧")
    status_parser.add_argument(
        "--all", "-a", action="store_true", default=False,
        help="履歴を含む全セッションを表示",
    )
    status_parser.set_defaults(func=_cmd_status)

    args = parser.parse_args()

    # 旧CLI形式の検出
    if args.command is None:
        # サブコマンドなし → 旧形式の可能性
        if len(sys.argv) > 1:
            # --fallback-stdin や直接プロンプトなど旧形式
            print(_MIGRATION_MESSAGE, file=sys.stderr)
            sys.exit(1)
        else:
            parser.print_help()
            sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
