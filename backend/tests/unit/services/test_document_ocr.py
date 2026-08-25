from unittest.mock import AsyncMock

import fitz
import pytesseract
import pytest
from PIL import Image

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


def test_tesseract_layout_drops_low_confidence_hallucinations(monkeypatch):
    data = {
        "text": ["R.O.", "GARBLED", "OPENED", "21JUL26"],
        "conf": ["96", "12", "93", "91"],
        "page_num": [1, 1, 1, 1],
        "block_num": [1, 1, 1, 1],
        "par_num": [1, 1, 1, 1],
        "line_num": [1, 1, 1, 2],
        "left": [10, 45, 80, 10],
    }
    monkeypatch.setattr(pytesseract, "image_to_data", lambda *_args, **_kwargs: data)

    text = DocumentOCRService._tesseract_confident_text(Image.new("RGB", (2100, 100)))

    assert text == "R.O. OPENED\n21JUL26"
    assert "GARBLED" not in text
