"""Public application identity endpoint tests."""

import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.integration
@pytest.mark.asyncio
async def test_version_endpoint_is_public_and_reports_runtime_identity(client: AsyncClient):
    response = await client.get("/api/version")

    assert response.status_code == 200
    assert response.json() == {
        "app": settings.app_name,
        "version": settings.app_version,
        "build_commit": settings.build_commit,
    }
