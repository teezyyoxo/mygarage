from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.routes.settings import _reject_local_auth_without_admin


@pytest.mark.asyncio
async def test_local_auth_cannot_be_enabled_before_first_admin_exists():
    result = Mock()
    result.scalar_one.return_value = 0
    db = Mock()
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as exc_info:
        await _reject_local_auth_without_admin(db, "auth_mode", "local")

    assert exc_info.value.status_code == 409
    assert "first administrator" in exc_info.value.detail


@pytest.mark.asyncio
async def test_non_local_auth_updates_do_not_require_an_admin():
    db = Mock()
    db.execute = AsyncMock()

    await _reject_local_auth_without_admin(db, "auth_mode", "none")

    db.execute.assert_not_awaited()
