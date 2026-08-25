from unittest.mock import AsyncMock

import fitz
import pytest

from app.services.document_ocr import DocumentOCRService


@pytest.mark.asyncio
async def test_short_embedded_pdf_text_survives_empty_ocr_fallback(monkeypatch):
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Oil service 08/21/2026")
    pdf_bytes = document.tobytes()
    document.close()

    service = DocumentOCRService()
    empty_ocr = AsyncMock(return_value="")
    monkeypatch.setattr(service, "_ocr_pdf_bytes", empty_ocr)

    text = await service.extract_text(pdf_bytes, is_pdf=True)

    assert "Oil service 08/21/2026" in text
    empty_ocr.assert_awaited_once()
