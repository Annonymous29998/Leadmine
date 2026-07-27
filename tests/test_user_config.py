"""Tests for ~/.leadmine/config.json persistence."""

from __future__ import annotations

import json

import pytest

from src.user_config import CONFIG_FILE, UserConfig, load_user_config, save_user_config


@pytest.fixture
def config_path(tmp_path, monkeypatch):
    cfg_dir = tmp_path / ".leadmine"
    cfg_file = cfg_dir / "config.json"
    monkeypatch.setattr("src.user_config.CONFIG_DIR", cfg_dir)
    monkeypatch.setattr("src.user_config.CONFIG_FILE", cfg_file)
    return cfg_file


def test_save_and_load_domains(config_path):
    config = UserConfig(domains=["gmail.com", "outlook.com"], export_path="/tmp/out")
    save_user_config(config)
    loaded = load_user_config()
    assert loaded.domains == ["gmail.com", "outlook.com"]
    assert loaded.export_path == "/tmp/out"
    data = json.loads(config_path.read_text())
    assert data["domains"] == ["gmail.com", "outlook.com"]


def test_load_missing_returns_defaults(config_path):
    config = load_user_config()
    assert "gmail.com" in config.domains
    assert config.export_path == ""


def test_resolved_export_dir_uses_custom_path(tmp_path):
    custom = tmp_path / "my_exports"
    config = UserConfig(export_path=str(custom))
    assert config.resolved_export_dir() == custom.resolve()
