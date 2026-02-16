"""slack_messages モジュールの包括的テスト

TASK-501, TEST-204, TEST-205, TASK-204, TASK-401, TEST-306 などを網羅する。
"""

from __future__ import annotations

import pytest

from src.slack_messages import (
    BLOCK_TEXT_MAX_CHARS,
    COMMAND_SUMMARY_MAX_CHARS,
    WRITE_CONTENT_PREVIEW_CHARS,
    _command_summary,
    _is_sensitive_file,
    _mask_secrets,
    _safe_block_text,
    _truncate,
    ask_question_blocks,
    ask_resolved_blocks,
    ask_timeout_blocks,
    client_disconnected_blocks,
    error_alert_blocks,
    permission_blocks,
    permission_resolved_blocks,
    permission_timeout_blocks,
    periodic_progress_blocks,
    session_end_blocks,
    session_start_blocks,
    timeout_warning_blocks,
    todo_progress_blocks,
)


# ============================================================
# TASK-501: _command_summary for all tool types
# ============================================================


class TestCommandSummaryBash:
    """TASK-501: Bash ツールのコマンドサマリ"""

    def test_bash_short_command(self):
        """短いコマンドはそのまま表示される。"""
        result = _command_summary("Bash", {"command": "ls -la"})
        assert result["tool"] == "Bash"
        assert result["description"] == "ls -la"
        assert result["truncated"] is False

    def test_bash_long_command_truncation(self):
        """COMMAND_SUMMARY_MAX_CHARS を超えるコマンドは切り捨てられる。"""
        long_cmd = "x" * 3000
        result = _command_summary("Bash", {"command": long_cmd})
        assert result["truncated"] is True
        assert len(result["description"]) <= COMMAND_SUMMARY_MAX_CHARS
        assert "truncated" in result["description"]

    def test_bash_no_command(self):
        """command キーがない場合は "(no command)" が表示される。"""
        result = _command_summary("Bash", {})
        assert result["description"] == "(no command)"

    def test_bash_cwd_scope(self):
        """cwd がある場合は scope に反映される。"""
        result = _command_summary("Bash", {"command": "ls", "cwd": "/home/user"})
        assert result["scope"] == "/home/user"

    def test_bash_working_directory_scope(self):
        """working_directory キーも scope として認識される。"""
        result = _command_summary("Bash", {"command": "ls", "working_directory": "/tmp"})
        assert result["scope"] == "/tmp"

    def test_bash_secrets_masked(self):
        """コマンド中の秘匿情報がマスキングされる。"""
        result = _command_summary("Bash", {"command": "curl -H 'Bearer sk-abc123'"})
        assert "sk-abc123" not in result["description"]
        assert "***" in result["description"]


class TestCommandSummaryWrite:
    """TASK-501: Write ツールのコマンドサマリ"""

    def test_write_file_path_and_preview(self):
        """ファイルパスと内容プレビューが表示される。"""
        result = _command_summary("Write", {
            "file_path": "/app/main.py",
            "content": "print('hello')",
        })
        assert "[File: /app/main.py]" in result["description"]
        assert "print('hello')" in result["description"]
        assert result["scope"] == "/app"
        assert result["is_new_file"] is True

    def test_write_long_content_truncation(self):
        """WRITE_CONTENT_PREVIEW_CHARS を超える内容は切り捨てられる。"""
        long_content = "a" * 1000
        result = _command_summary("Write", {
            "file_path": "/app/data.txt",
            "content": long_content,
        })
        assert result["truncated"] is True
        assert len(result["description"]) <= WRITE_CONTENT_PREVIEW_CHARS + 100  # ファイルパス行分の余裕

    def test_write_sensitive_file_hidden(self):
        """TEST-205: 機密ファイルの場合、内容が隠される。"""
        result = _command_summary("Write", {
            "file_path": "/app/.env",
            "content": "SECRET_KEY=abc123",
        })
        assert "content hidden" in result["description"]
        assert "SECRET_KEY" not in result["description"]
        assert "/app/.env" in result["description"]

    def test_write_no_path(self):
        """file_path がない場合は "(no path)" が表示される。"""
        result = _command_summary("Write", {"content": "hello"})
        assert "(no path)" in result["description"]

    def test_write_scope_is_directory(self):
        """scope はファイルパスのディレクトリ部分。"""
        result = _command_summary("Write", {"file_path": "/a/b/c.py", "content": ""})
        assert result["scope"] == "/a/b"

    def test_write_scope_no_directory(self):
        """ファイルパスにディレクトリがない場合は "." がスコープ。"""
        result = _command_summary("Write", {"file_path": "file.txt", "content": ""})
        assert result["scope"] == "."


class TestCommandSummaryEdit:
    """TASK-501: Edit ツールのコマンドサマリ"""

    def test_edit_diff_format(self):
        """old_string/new_string が diff 形式 (-/+) で表示される。"""
        result = _command_summary("Edit", {
            "file_path": "/app/main.py",
            "old_string": "foo = 1",
            "new_string": "foo = 2",
        })
        assert "[File: /app/main.py]" in result["description"]
        assert "- foo = 1" in result["description"]
        assert "+ foo = 2" in result["description"]
        assert result["is_new_file"] is False

    def test_edit_multiline_diff(self):
        """複数行の old/new が正しく diff 表示される。"""
        result = _command_summary("Edit", {
            "file_path": "/app/main.py",
            "old_string": "line1\nline2",
            "new_string": "new1\nnew2\nnew3",
        })
        assert "- line1" in result["description"]
        assert "- line2" in result["description"]
        assert "+ new1" in result["description"]
        assert "+ new2" in result["description"]
        assert "+ new3" in result["description"]

    def test_edit_sensitive_file_hidden(self):
        """TEST-205: 機密ファイルは内容が隠される。"""
        result = _command_summary("Edit", {
            "file_path": "/app/credentials.json",
            "old_string": "old_secret",
            "new_string": "new_secret",
        })
        assert "content hidden" in result["description"]
        assert "old_secret" not in result["description"]
        assert "new_secret" not in result["description"]

    def test_edit_long_diff_truncation(self):
        """長い diff は COMMAND_SUMMARY_MAX_CHARS で切り捨てられる。"""
        long_old = "old_line\n" * 500
        long_new = "new_line\n" * 500
        result = _command_summary("Edit", {
            "file_path": "/app/big.py",
            "old_string": long_old,
            "new_string": long_new,
        })
        assert result["truncated"] is True
        assert len(result["description"]) <= COMMAND_SUMMARY_MAX_CHARS


class TestCommandSummaryOther:
    """TASK-501: その他ツールのコマンドサマリ"""

    def test_other_tool_str_representation(self):
        """未知のツールは str(input_data) が表示される。"""
        result = _command_summary("WebFetch", {"url": "https://example.com"})
        assert "https://example.com" in result["description"]

    def test_other_tool_long_data_truncation(self):
        """長いデータは切り捨てられる。"""
        result = _command_summary("SomeTool", {"data": "x" * 5000})
        assert result["truncated"] is True
        assert len(result["description"]) <= COMMAND_SUMMARY_MAX_CHARS

    def test_other_tool_secrets_masked(self):
        """その他ツールでも秘匿情報がマスキングされる。"""
        # str(dict) は 'key': 'value' 形式になるが、
        # xoxb- / sk- / ghp_ などの独立パターンはマスクされる
        result = _command_summary("CustomTool", {"auth_header": "xoxb-123-456-secret"})
        assert "xoxb-123-456-secret" not in result["description"]
        assert "***" in result["description"]

    def test_notebook_edit_summary(self):
        """NotebookEdit ツールのサマリ。"""
        result = _command_summary("NotebookEdit", {
            "notebook_path": "/app/analysis.ipynb",
        })
        assert "[Notebook: /app/analysis.ipynb]" in result["description"]
        assert result["scope"] == "/app"


# ============================================================
# TEST-204: Secret masking
# ============================================================


class TestMaskSecrets:
    """TEST-204: 秘匿情報のマスキング"""

    def test_token_equals(self):
        """token=xxx パターンのマスキング。"""
        assert "my_token" not in _mask_secrets("token=my_token")
        assert "***" in _mask_secrets("token=my_token")

    def test_password_equals(self):
        """password=xxx パターンのマスキング。"""
        assert "secret123" not in _mask_secrets("password=secret123")

    def test_key_equals(self):
        """key=xxx パターンのマスキング。"""
        assert "abc_key_value" not in _mask_secrets("key=abc_key_value")

    def test_secret_equals(self):
        """secret=xxx パターンのマスキング。"""
        assert "my_secret" not in _mask_secrets("secret=my_secret")

    def test_api_key_equals(self):
        """api_key=xxx パターンのマスキング。"""
        assert "key12345" not in _mask_secrets("api_key=key12345")

    def test_bearer_token(self):
        """Bearer トークンのマスキング。"""
        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload"
        masked = _mask_secrets(text)
        assert "eyJhbGciOiJIUzI1NiJ9" not in masked
        assert "***" in masked

    def test_xoxb_token(self):
        """xoxb- トークンのマスキング。"""
        masked = _mask_secrets("xoxb-123-456-abcdef")
        assert "xoxb-123-456-abcdef" not in masked
        assert "***" in masked

    def test_sk_token(self):
        """sk- トークンのマスキング。"""
        masked = _mask_secrets("sk-proj-abcdefg123456")
        assert "sk-proj-abcdefg123456" not in masked
        assert "***" in masked

    def test_ghp_token(self):
        """ghp_ トークンのマスキング。"""
        masked = _mask_secrets("ghp_xxxxxxxxxxxxxxxxxxxx")
        assert "ghp_xxxxxxxxxxxxxxxxxxxx" not in masked
        assert "***" in masked

    def test_no_secret_unchanged(self):
        """秘匿情報がないテキストは変更されない。"""
        text = "Hello world, this is normal text."
        assert _mask_secrets(text) == text

    def test_quoted_token_value(self):
        """引用符付きの token 値もマスキングされる。"""
        masked = _mask_secrets('token="my_secret_token"')
        assert "my_secret_token" not in masked

    def test_colon_separator(self):
        """key: value 形式（コロン区切り）もマスキングされる。"""
        masked = _mask_secrets("password: supersecret")
        assert "supersecret" not in masked

    def test_aws_access_key(self):
        """AWS アクセスキー風パターンのマスキング。"""
        masked = _mask_secrets("AKIAIOSFODNN7EXAMPLE")
        assert "AKIAIOSFODNN7EXAMPLE" not in masked

    def test_ghs_token(self):
        """ghs_ トークンのマスキング。"""
        masked = _mask_secrets("ghs_xxxxxxxxxxxx")
        assert "ghs_xxxxxxxxxxxx" not in masked


# ============================================================
# TEST-205: Sensitive file detection
# ============================================================


class TestIsSensitiveFile:
    """TEST-205: 機密ファイル判定"""

    def test_env_file(self):
        assert _is_sensitive_file("/app/.env") is True

    def test_env_local_file(self):
        assert _is_sensitive_file("/app/.env.local") is True

    def test_env_production_file(self):
        assert _is_sensitive_file("/app/.env.production") is True

    def test_credentials_json(self):
        assert _is_sensitive_file("/app/credentials.json") is True

    def test_credentials_yaml(self):
        assert _is_sensitive_file("/app/credentials.yaml") is True

    def test_pem_file(self):
        assert _is_sensitive_file("/certs/server.pem") is True

    def test_key_file(self):
        assert _is_sensitive_file("/certs/private.key") is True

    def test_secret_file(self):
        assert _is_sensitive_file("/app/api.secret") is True

    def test_id_rsa(self):
        assert _is_sensitive_file("/home/user/.ssh/id_rsa") is True

    def test_id_ed25519(self):
        assert _is_sensitive_file("/home/user/.ssh/id_ed25519") is True

    def test_normal_python_file(self):
        assert _is_sensitive_file("/app/main.py") is False

    def test_normal_json_file(self):
        assert _is_sensitive_file("/app/config.json") is False

    def test_normal_text_file(self):
        assert _is_sensitive_file("/app/README.md") is False


# ============================================================
# TASK-204: Block Kit text truncation
# ============================================================


class TestBlockTextTruncation:
    """TASK-204: Block Kit テキストの文字数制限"""

    def test_short_text_no_truncation(self):
        """短いテキストはそのまま返される。"""
        text = "Hello, world!"
        assert _safe_block_text(text) == text

    def test_long_text_truncated_to_max(self):
        """BLOCK_TEXT_MAX_CHARS を超えるテキストは切り捨てられる。"""
        long_text = "a" * 5000
        result = _safe_block_text(long_text)
        assert len(result) <= BLOCK_TEXT_MAX_CHARS
        assert "truncated" in result

    def test_truncate_function_returns_tuple(self):
        """_truncate は (テキスト, 切り捨てフラグ) のタプルを返す。"""
        text, was_truncated = _truncate("short", 100)
        assert text == "short"
        assert was_truncated is False

        text, was_truncated = _truncate("a" * 200, 50)
        assert len(text) <= 50
        assert was_truncated is True

    def test_exact_boundary_no_truncation(self):
        """ちょうど上限の場合は切り捨てされない。"""
        text = "a" * BLOCK_TEXT_MAX_CHARS
        result = _safe_block_text(text)
        assert result == text


# ============================================================
# permission_blocks structure validation
# ============================================================


class TestPermissionBlocks:
    """permission_blocks の構造バリデーション"""

    def test_basic_structure(self):
        """基本的なブロック構造: header, section(fields), section(code), actions, context。"""
        blocks = permission_blocks("Bash", {"command": "ls"}, "corr-123", 120)
        block_types = [b["type"] for b in blocks]
        assert "header" in block_types
        assert "actions" in block_types
        assert "context" in block_types

    def test_header_text(self):
        """ヘッダーが "Permission Required" であること。"""
        blocks = permission_blocks("Bash", {"command": "ls"}, "corr-123", 120)
        header = blocks[0]
        assert header["text"]["text"] == "Permission Required"

    def test_allow_deny_buttons(self):
        """Allow/Deny ボタンが存在すること。"""
        blocks = permission_blocks("Bash", {"command": "ls"}, "corr-123", 120)
        actions_block = next(b for b in blocks if b["type"] == "actions")
        action_ids = [e["action_id"] for e in actions_block["elements"]]
        assert "perm_allow" in action_ids
        assert "perm_deny" in action_ids

    def test_correlation_id_in_buttons(self):
        """ボタンの value に correlation_id が含まれること。"""
        blocks = permission_blocks("Bash", {"command": "ls"}, "corr-XYZ", 120)
        actions_block = next(b for b in blocks if b["type"] == "actions")
        for btn in actions_block["elements"]:
            assert btn["value"] == "corr-XYZ"

    def test_timeout_display(self):
        """タイムアウトが分単位で表示されること。"""
        blocks = permission_blocks("Bash", {"command": "ls"}, "corr-123", 300)
        context_block = next(b for b in blocks if b["type"] == "context")
        text = context_block["elements"][0]["text"]
        assert "5min" in text

    def test_description_shown_when_provided(self):
        """TASK-202: description がある場合は "Why" セクションが表示される。"""
        blocks = permission_blocks(
            "Bash",
            {"command": "rm -rf /tmp/test", "description": "Clean up temp files"},
            "corr-123",
            120,
        )
        texts = [b.get("text", {}).get("text", "") for b in blocks if b["type"] == "section"]
        assert any("Why" in t and "Clean up temp files" in t for t in texts)

    def test_scope_shown_for_bash_with_cwd(self):
        """TASK-203: Bash の cwd がスコープとして表示される。"""
        blocks = permission_blocks(
            "Bash",
            {"command": "ls", "cwd": "/home/user/project"},
            "corr-123",
            120,
        )
        texts = [b.get("text", {}).get("text", "") for b in blocks if b["type"] == "section"]
        assert any("Scope" in t and "/home/user/project" in t for t in texts)

    def test_truncated_indicator_for_long_command(self):
        """長いコマンドには truncated インジケータが付く。"""
        blocks = permission_blocks("Bash", {"command": "x" * 5000}, "corr-123", 120)
        all_text = " ".join(
            b.get("text", {}).get("text", "") for b in blocks if b["type"] == "section"
        )
        assert "truncated" in all_text


# ============================================================
# permission_resolved_blocks with summary_text
# ============================================================


class TestPermissionResolvedBlocks:
    """permission_resolved_blocks の構造テスト"""

    def test_allow_decision(self):
        """Allow 決定時のメッセージ。"""
        blocks = permission_resolved_blocks("Bash", "allow", "U123")
        text = blocks[0]["text"]["text"]
        assert ":white_check_mark:" in text
        assert "ALLOW" in text
        assert "<@U123>" in text

    def test_deny_decision(self):
        """Deny 決定時のメッセージ。"""
        blocks = permission_resolved_blocks("Bash", "deny", "U456")
        text = blocks[0]["text"]["text"]
        assert ":x:" in text
        assert "DENY" in text

    def test_summary_text_included(self):
        """summary_text がある場合はコンテキストブロックに表示される。"""
        blocks = permission_resolved_blocks("Bash", "allow", "U123", summary_text="ls -la")
        assert len(blocks) == 2
        context_block = blocks[1]
        assert context_block["type"] == "context"
        assert "ls -la" in context_block["elements"][0]["text"]

    def test_no_summary_text(self):
        """summary_text がない場合はコンテキストブロックなし。"""
        blocks = permission_resolved_blocks("Bash", "allow", "U123")
        assert len(blocks) == 1


# ============================================================
# session_start_blocks with long prompts (200 char expansion)
# ============================================================


class TestSessionStartBlocks:
    """session_start_blocks のテスト"""

    def test_short_prompt(self):
        """短いプロンプトはそのまま表示される。"""
        blocks = session_start_blocks("Fix the bug", "/app", "sess-001")
        header = blocks[0]
        assert "sess-001" in header["text"]["text"]
        section = blocks[1]
        fields_texts = [f["text"] for f in section["fields"]]
        assert any("Fix the bug" in t for t in fields_texts)
        assert any("/app" in t for t in fields_texts)
        # 短いプロンプトでは context ブロックなし
        assert len(blocks) == 2

    def test_long_prompt_expansion(self):
        """200 文字を超えるプロンプトは折りたたみセクションが追加される。"""
        long_prompt = "A" * 300
        blocks = session_start_blocks(long_prompt, "/app", "sess-002")
        # 3 つのブロック: header, section(fields), context(full prompt)
        assert len(blocks) == 3
        # 要約表示は 200 文字 + "..."
        section = blocks[1]
        prompt_field = next(f for f in section["fields"] if "Prompt" in f["text"])
        assert "..." in prompt_field["text"]
        # 全文がコンテキストブロックに含まれる
        context = blocks[2]
        assert context["type"] == "context"
        assert "Full prompt" in context["elements"][0]["text"]

    def test_exactly_200_chars_no_expansion(self):
        """ちょうど 200 文字のプロンプトは折りたたまない。"""
        prompt = "B" * 200
        blocks = session_start_blocks(prompt, "/app", "sess-003")
        assert len(blocks) == 2


# ============================================================
# session_end_blocks with rich summary
# ============================================================


class TestSessionEndBlocks:
    """session_end_blocks のリッチサマリテスト"""

    def test_completed_status(self):
        """completed ステータスのメッセージ。"""
        blocks = session_end_blocks("sess-001", "completed")
        text = blocks[0]["text"]["text"]
        assert ":white_check_mark:" in text
        assert "completed" in text

    def test_error_status(self):
        """error ステータスのメッセージ。"""
        blocks = session_end_blocks("sess-001", "error")
        text = blocks[0]["text"]["text"]
        assert ":x:" in text
        assert "error" in text

    def test_other_status(self):
        """不明ステータスのメッセージ。"""
        blocks = session_end_blocks("sess-001", "cancelled")
        text = blocks[0]["text"]["text"]
        assert ":black_square_for_stop:" in text
        assert "cancelled" in text

    def test_duration_minutes_and_seconds(self):
        """所要時間が分・秒で表示される。"""
        blocks = session_end_blocks("sess-001", "completed", duration_sec=125.5)
        all_text = str(blocks)
        assert "2m 5s" in all_text

    def test_duration_seconds_only(self):
        """60 秒未満は秒のみ表示。"""
        blocks = session_end_blocks("sess-001", "completed", duration_sec=45.0)
        all_text = str(blocks)
        assert "45s" in all_text
        assert "0m" not in all_text

    def test_tool_stats(self):
        """ツール統計が表示される。"""
        stats = {"total_uses": 10, "allowed": 5, "denied": 2, "auto_allowed": 3}
        blocks = session_end_blocks("sess-001", "completed", tool_stats=stats)
        all_text = str(blocks)
        assert "Total: 10" in all_text

    def test_changed_files(self):
        """変更ファイルリストが表示される。"""
        files = ["/app/main.py", "/app/utils.py"]
        blocks = session_end_blocks("sess-001", "completed", changed_files=files)
        all_text = str(blocks)
        assert "/app/main.py" in all_text
        assert "/app/utils.py" in all_text

    def test_changed_files_over_20_truncated(self):
        """20 ファイルを超える場合は "... and N more" が表示される。"""
        files = [f"/app/file_{i}.py" for i in range(25)]
        blocks = session_end_blocks("sess-001", "completed", changed_files=files)
        all_text = str(blocks)
        assert "5 more" in all_text

    def test_error_message(self):
        """エラーメッセージが表示される。"""
        blocks = session_end_blocks("sess-001", "error", error_message="Something failed")
        all_text = str(blocks)
        assert "Something failed" in all_text

    def test_full_rich_summary(self):
        """全情報を含むリッチサマリ。"""
        blocks = session_end_blocks(
            "sess-001",
            "completed",
            duration_sec=300.0,
            tool_stats={"total_uses": 5, "allowed": 3, "denied": 1, "auto_allowed": 1},
            changed_files=["/app/main.py"],
        )
        # 少なくとも 3 ブロック: status, stats fields, changed files
        assert len(blocks) >= 3


# ============================================================
# todo_progress_blocks format
# ============================================================


class TestTodoProgressBlocks:
    """todo_progress_blocks のフォーマットテスト"""

    def test_empty_todos(self):
        """空の todo リストは空のブロックリストを返す。"""
        blocks = todo_progress_blocks([], "sess-001")
        assert blocks == []

    def test_progress_bar_and_counts(self):
        """進捗バーとカウントが表示される。"""
        todos = [
            {"content": "Task 1", "status": "completed"},
            {"content": "Task 2", "activeForm": "Working on Task 2", "status": "in_progress"},
            {"content": "Task 3", "status": "pending"},
        ]
        blocks = todo_progress_blocks(todos, "sess-001")
        text = blocks[0]["text"]["text"]
        assert "1/3" in text
        assert "33%" in text
        assert "Task 1" in text

    def test_status_icons(self):
        """各ステータスに対応するアイコンが表示される。"""
        todos = [
            {"content": "Done task", "status": "completed"},
            {"content": "Active task", "activeForm": "Doing active", "status": "in_progress"},
            {"content": "Pending task", "status": "pending"},
        ]
        blocks = todo_progress_blocks(todos, "sess-001")
        text = blocks[0]["text"]["text"]
        # completed
        assert "~Done task~" in text
        # in_progress はアクティブフォーム表示
        assert "*Doing active*" in text
        # pending
        assert "Pending task" in text

    def test_session_id_in_context(self):
        """セッション ID がコンテキストブロックに表示される。"""
        todos = [{"content": "Task", "status": "pending"}]
        blocks = todo_progress_blocks(todos, "sess-XYZ")
        context = blocks[1]
        assert context["type"] == "context"
        assert "sess-XYZ" in context["elements"][0]["text"]

    def test_all_completed_100_percent(self):
        """全タスク完了時は 100% 表示。"""
        todos = [
            {"content": "A", "status": "completed"},
            {"content": "B", "status": "completed"},
        ]
        blocks = todo_progress_blocks(todos, "sess-001")
        text = blocks[0]["text"]["text"]
        assert "100%" in text
        assert "2/2" in text


# ============================================================
# TASK-401: ask_question_blocks with description display
# ============================================================


class TestAskQuestionBlocks:
    """ask_question_blocks のテスト"""

    def test_basic_structure(self):
        """基本的なブロック構造。"""
        blocks = ask_question_blocks(
            question_text="Which option?",
            header="Choose one",
            options=[{"label": "A"}, {"label": "B"}],
            correlation_id="corr-1",
            question_index=0,
            multi_select=False,
            timeout_sec=120,
        )
        block_types = [b["type"] for b in blocks]
        assert "header" in block_types
        assert "section" in block_types
        assert "actions" in block_types

    def test_description_display(self):
        """TASK-401: 選択肢に description がある場合、context ブロックに表示される。"""
        blocks = ask_question_blocks(
            question_text="Pick a framework",
            header="Framework",
            options=[
                {"label": "React", "description": "A JavaScript library for UIs"},
                {"label": "Vue", "description": "Progressive framework"},
            ],
            correlation_id="corr-1",
            question_index=0,
            multi_select=False,
            timeout_sec=120,
        )
        context_blocks = [b for b in blocks if b["type"] == "context"]
        assert len(context_blocks) == 1
        elements_text = " ".join(e["text"] for e in context_blocks[0]["elements"])
        assert "React" in elements_text
        assert "A JavaScript library for UIs" in elements_text
        assert "Vue" in elements_text

    def test_no_description_no_context(self):
        """description がない場合は context ブロックなし。"""
        blocks = ask_question_blocks(
            question_text="Pick one",
            header="Choice",
            options=[{"label": "A"}, {"label": "B"}],
            correlation_id="corr-1",
            question_index=0,
            multi_select=False,
            timeout_sec=120,
        )
        context_blocks = [b for b in blocks if b["type"] == "context"]
        assert len(context_blocks) == 0

    def test_multi_select_confirm_button(self):
        """multi_select の場合は Confirm ボタンが追加される。"""
        blocks = ask_question_blocks(
            question_text="Select all",
            header="Multi",
            options=[{"label": "A"}, {"label": "B"}],
            correlation_id="corr-1",
            question_index=0,
            multi_select=True,
            timeout_sec=120,
        )
        actions_block = next(b for b in blocks if b["type"] == "actions")
        button_texts = [e["text"]["text"] for e in actions_block["elements"]]
        assert any("Confirm" in t for t in button_texts)

    def test_multi_select_header_suffix(self):
        """multi_select の場合はヘッダーに "(select multiple)" が付く。"""
        blocks = ask_question_blocks(
            question_text="Pick",
            header="Options",
            options=[{"label": "A"}],
            correlation_id="corr-1",
            question_index=0,
            multi_select=True,
            timeout_sec=120,
        )
        header_text = blocks[0]["text"]["text"]
        assert "select multiple" in header_text

    def test_other_button_always_present(self):
        """Other ボタンは常に存在する。"""
        blocks = ask_question_blocks(
            question_text="Pick",
            header="Choice",
            options=[{"label": "A"}],
            correlation_id="corr-1",
            question_index=0,
            multi_select=False,
            timeout_sec=120,
        )
        actions_block = next(b for b in blocks if b["type"] == "actions")
        button_texts = [e["text"]["text"] for e in actions_block["elements"]]
        assert "Other..." in button_texts

    def test_selected_labels_displayed(self):
        """選択済みラベルに チェック マークが付く。"""
        blocks = ask_question_blocks(
            question_text="Pick",
            header="Multi",
            options=[{"label": "A"}, {"label": "B"}],
            correlation_id="corr-1",
            question_index=0,
            multi_select=True,
            timeout_sec=120,
            selected_labels=["A"],
        )
        actions_block = next(b for b in blocks if b["type"] == "actions")
        a_btn = actions_block["elements"][0]
        b_btn = actions_block["elements"][1]
        assert a_btn["text"]["text"].startswith("✅")
        assert not b_btn["text"]["text"].startswith("✅")


# ============================================================
# TEST-306: error_alert_blocks contains <!channel>
# ============================================================


class TestErrorAlertBlocks:
    """TEST-306: error_alert_blocks のテスト"""

    def test_contains_channel_mention(self):
        """<!channel> が含まれること。"""
        blocks = error_alert_blocks("sess-001", "Something broke")
        text = blocks[0]["text"]["text"]
        assert "<!channel>" in text

    def test_contains_error_message(self):
        """エラーメッセージが含まれること。"""
        blocks = error_alert_blocks("sess-001", "Connection timeout")
        text = blocks[0]["text"]["text"]
        assert "Connection timeout" in text

    def test_contains_session_id(self):
        """セッション ID が含まれること。"""
        blocks = error_alert_blocks("sess-ABC", "Error")
        text = blocks[0]["text"]["text"]
        assert "sess-ABC" in text

    def test_contains_rotating_light_emoji(self):
        """回転ランプ絵文字が含まれること。"""
        blocks = error_alert_blocks("sess-001", "Error")
        text = blocks[0]["text"]["text"]
        assert ":rotating_light:" in text


# ============================================================
# timeout_warning_blocks format
# ============================================================


class TestTimeoutWarningBlocks:
    """timeout_warning_blocks のフォーマットテスト"""

    def test_contains_channel_mention(self):
        """<!channel> が含まれること。"""
        blocks = timeout_warning_blocks("sess-001", 3)
        text = blocks[0]["text"]["text"]
        assert "<!channel>" in text

    def test_contains_consecutive_count(self):
        """連続タイムアウト回数が表示されること。"""
        blocks = timeout_warning_blocks("sess-001", 5)
        text = blocks[0]["text"]["text"]
        assert "5" in text
        assert "consecutive timeouts" in text

    def test_contains_session_id(self):
        """セッション ID が含まれること。"""
        blocks = timeout_warning_blocks("sess-XYZ", 2)
        text = blocks[0]["text"]["text"]
        assert "sess-XYZ" in text

    def test_contains_warning_emoji(self):
        """警告絵文字が含まれること。"""
        blocks = timeout_warning_blocks("sess-001", 1)
        text = blocks[0]["text"]["text"]
        assert ":warning:" in text


# ============================================================
# 追加テスト: permission_timeout_blocks, ask_resolved/timeout,
# periodic_progress_blocks
# ============================================================


class TestPermissionTimeoutBlocks:
    """permission_timeout_blocks のテスト"""

    def test_format(self):
        blocks = permission_timeout_blocks("Bash")
        text = blocks[0]["text"]["text"]
        assert ":hourglass:" in text
        assert "TIMED OUT" in text
        assert "Bash" in text


class TestAskResolvedBlocks:
    """ask_resolved_blocks のテスト"""

    def test_format(self):
        blocks = ask_resolved_blocks("What color?", "Blue", "U123")
        text = blocks[0]["text"]["text"]
        assert ":white_check_mark:" in text
        assert "What color?" in text
        assert "Blue" in text
        assert "<@U123>" in text


class TestAskTimeoutBlocks:
    """ask_timeout_blocks のテスト"""

    def test_format(self):
        blocks = ask_timeout_blocks("Which option?")
        text = blocks[0]["text"]["text"]
        assert ":hourglass:" in text
        assert "TIMED OUT" in text
        assert "Which option?" in text


class TestPeriodicProgressBlocks:
    """periodic_progress_blocks のテスト"""

    def test_basic_format(self):
        blocks = periodic_progress_blocks("sess-001", 90.0, 5)
        text = blocks[0]["text"]["text"]
        assert "1m 30s" in text
        assert "5" in text

    def test_with_last_tool(self):
        blocks = periodic_progress_blocks("sess-001", 30.0, 2, last_tool="Bash")
        text = blocks[0]["text"]["text"]
        assert "Bash" in text

    def test_seconds_only(self):
        blocks = periodic_progress_blocks("sess-001", 45.0, 1)
        text = blocks[0]["text"]["text"]
        assert "45s" in text


# ============================================================
# TASK-603: client_disconnected_blocks
# ============================================================


class TestClientDisconnectedBlocks:
    """TASK-603: client_disconnected_blocks のテスト"""

    def test_contains_session_id(self):
        blocks = client_disconnected_blocks("sess-ABC")
        text = blocks[0]["text"]["text"]
        assert "sess-ABC" in text

    def test_contains_disconnect_message(self):
        blocks = client_disconnected_blocks("sess-001")
        text = blocks[0]["text"]["text"]
        assert "CLI" in text
        assert "continues" in text.lower() or "running" in text.lower()

    def test_contains_plug_emoji(self):
        blocks = client_disconnected_blocks("sess-001")
        text = blocks[0]["text"]["text"]
        assert ":electric_plug:" in text
