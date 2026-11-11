import sys
import types

import uvicorn

from vector.__main__ import _ensure_std_streams, main


def test_missing_std_streams_are_replaced(monkeypatch):
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    _ensure_std_streams()

    try:
        assert sys.stdout is not None
        assert sys.stderr is not None
        assert sys.stdout.isatty() is False
        assert sys.stderr.isatty() is False
    finally:
        for name in ("stdout", "stderr"):
            stream = getattr(sys, name)
            if stream is not None:
                stream.close()


def test_uvicorn_accepts_missing_std_streams_without_its_log_config(monkeypatch):
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)

    # Config.__init__ calls configure_logging(); with log_config=None it must
    # leave the app's own handlers alone instead of building uvicorn's colour
    # formatters, which call sys.stdout.isatty().
    config = uvicorn.Config("vector.server:app", log_config=None, log_level="warning")

    assert config.log_config is None


def test_main_does_not_override_app_logging(monkeypatch):
    import vector.server

    calls = {}
    monkeypatch.setattr(vector.server, "get_state", lambda: types.SimpleNamespace())
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: calls.update(kwargs))

    main(["--no-browser"])

    assert calls["log_config"] is None
