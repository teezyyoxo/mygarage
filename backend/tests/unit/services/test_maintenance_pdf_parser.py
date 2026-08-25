from datetime import date

import pytest

from app.services.maintenance_pdf_parser import (
    MaintenancePdfParseError,
    parse_maintenance_text,
)


def test_parses_common_maintenance_invoice_fields():
    parsed = parse_maintenance_text(
        """
        Example Auto Service LLC
        Invoice Number: RO-4821
        Invoice Date: 08/21/2026
        Odometer: 52,410 mi
        Performed engine oil and oil filter change
        Replaced cabin air filter
        Grand Total: $189.42
        """
    )

    assert parsed["date"] == date(2026, 8, 21)
    assert parsed["mileage"] == 52410
    assert parsed["mileage_unit"] == "mi"
    assert parsed["total_cost"] == 189.42
    assert parsed["invoice_number"] == "RO-4821"
    assert parsed["shop"] == "Example Auto Service LLC"
    assert "Oil service" in parsed["description"]


def test_explains_when_scanned_pdf_produces_no_text():
    with pytest.raises(MaintenancePdfParseError, match="No usable text was extracted"):
        parse_maintenance_text("   \n")


def test_refuses_to_fabricate_a_service_date():
    with pytest.raises(MaintenancePdfParseError, match="no recognizable service date"):
        parse_maintenance_text(
            "Performed engine oil and filter change after a complete vehicle inspection."
        )
