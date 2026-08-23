"""In-memory ring buffer of recent log records, for the Settings -> System log viewer.

Logs are otherwise stdout/stderr-only (captured by Docker's log driver), so
there was no way to see them from the UI. This handler mirrors everything the
root logger emits into a small in-memory deque that a polling API endpoint can
read — no persistence, no extra dependencies, cleared on restart.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from datetime import datetime, timezone

MAX_LOG_LINES = 1000


class RingBufferLogHandler(logging.Handler):
    """Keeps the most recent log records in memory for API retrieval."""

    def __init__(self, capacity: int = MAX_LOG_LINES) -> None:
        super().__init__()
        self._buffer: deque[dict] = deque(maxlen=capacity)
        self._lock = threading.Lock()
        self._next_id = 1

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = self.format(record)
        except Exception:
            message = record.getMessage()
        with self._lock:
            entry = {
                "id": self._next_id,
                "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "message": message,
            }
            self._next_id += 1
            self._buffer.append(entry)

    def get_recent(self, limit: int = 200, after_id: int | None = None) -> list[dict]:
        with self._lock:
            entries = list(self._buffer)
        if after_id is not None:
            entries = [e for e in entries if e["id"] > after_id]
        if limit:
            entries = entries[-limit:]
        return entries


log_buffer_handler = RingBufferLogHandler()
