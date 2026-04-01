"""TASK-407: Config バリデーションのテスト"""

from __future__ import annotations

import pytest

from src.config import Config, ConfigValidationError


def _make_config(**overrides) -> Config:
    defaults = dict(
        slack_app_token="xapp-1-A0001-000-abc123",
        slack_bot_token="xoxb-111-222-abc123",
        slack_channel="test-channel",
        slack_approver_user_id="UAPPROVER01",
    )
    defaults.update(overrides)
    return Config(**defaults)


# --- TASK-407: PROGRESS_INTERVAL_SEC の Config バリデーションテスト ---


class TestProgressIntervalSecValidation:
    """PROGRESS_INTERVAL_SEC の範囲バリデーション（10〜600秒）。"""

    def test_default_value(self):
        """デフォルト値（120秒）で正常に設定される。"""
        config = _make_config()
        assert config.progress_interval_sec == 120

    def test_min_boundary_valid(self):
        """下限値（10秒）は有効。"""
        config = _make_config(progress_interval_sec=10)
        assert config.progress_interval_sec == 10

    def test_max_boundary_valid(self):
        """上限値（600秒）は有効。"""
        config = _make_config(progress_interval_sec=600)
        assert config.progress_interval_sec == 600

    def test_mid_range_valid(self):
        """範囲内の値（60秒）は有効。"""
        config = _make_config(progress_interval_sec=60)
        assert config.progress_interval_sec == 60

    def test_below_min_raises(self):
        """下限未満（9秒）で ConfigValidationError が発生する。"""
        with pytest.raises(ConfigValidationError, match="PROGRESS_INTERVAL_SEC.*>= 10"):
            _make_config(progress_interval_sec=9)

    def test_above_max_raises(self):
        """上限超過（601秒）で ConfigValidationError が発生する。"""
        with pytest.raises(ConfigValidationError, match="PROGRESS_INTERVAL_SEC.*<= 600"):
            _make_config(progress_interval_sec=601)

    def test_zero_raises(self):
        """0秒で ConfigValidationError が発生する。"""
        with pytest.raises(ConfigValidationError, match="PROGRESS_INTERVAL_SEC"):
            _make_config(progress_interval_sec=0)

    def test_negative_raises(self):
        """負の値で ConfigValidationError が発生する。"""
        with pytest.raises(ConfigValidationError, match="PROGRESS_INTERVAL_SEC"):
            _make_config(progress_interval_sec=-1)


# --- interrupt_queue_maxsize の設定テスト ---


class TestInterruptQueueMaxsize:
    """interrupt_queue_maxsize の設定テスト。"""

    def test_default_value(self):
        """デフォルト値（5）で正常に設定される。"""
        config = _make_config()
        assert config.interrupt_queue_maxsize == 5

    def test_custom_value(self):
        """カスタム値で正常に設定される。"""
        config = _make_config(interrupt_queue_maxsize=10)
        assert config.interrupt_queue_maxsize == 10
