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


def test_parses_compact_dealership_ro_opened_date():
    parsed = parse_maintenance_text(
        """
        227739
        *INVOICE*
        Hamden Chevrolet
        Hamden Mazda Isuzu Truck
        VIN JM3KKBHD8T1360502
        MILEAGE IN/OUT
        9725/9725
        R.O. OPENED              READY
        09:37 21JUL26            16:06 21JUL26
        A CUSTOMER STATES INSTRUMENT CLUSTER/PANEL SEEMS TO REBOOT WHILE DRIVING
        TECHNICIAN SCANNED VEHICLE FOR CODES AND CHECKED MGSS FOR INFORMATION
        """
    )

    assert parsed["date"] == date(2026, 7, 21)
    assert "R.O. OPENED" in parsed["date_source"].upper()
    assert parsed["mileage"] == 9725
    assert parsed["invoice_number"] == "227739"
    assert "Inspection / diagnostic" in parsed["description"]


def test_incomplete_preview_returns_editable_blank_fields():
    parsed = parse_maintenance_text(
        "Performed engine oil and filter change after a complete vehicle inspection.",
        require_complete=False,
    )

    assert parsed["date"] is None
    assert parsed["description"] == "Oil service / Inspection / diagnostic"


def test_ro_opened_outranks_delivery_and_invoice_dates_and_cleans_notes():
    parsed = parse_maintenance_text(
        """
        DEL. DATE        PROD DATE       WARR. EXP.       PROMISED       INV DATE
        30DEC25          21NOV25         30DEC28          17:00 21JUL26  21JUL26
        R.O. OPENED              READY
        09:37 21JUL26            16:06 21JUL26
        A CUSTOMER STATES INSTRUMENT CLUSTER/PANEL SEEMS TO REBOOT WHILE DRIVING
        9725 TECHNICIAN SCANNED VEHICLE FOR CODES AND CHECKED MGSS FOR
        INFORMATION RELATED TO CUSTOMER'S CONCERN. NO CODES STORED IN DTC OR
        TSB AT THIS TIME. ADVISED CUSTOMER TO RETURN IF CONCERN PERSISTS
        MULTI-POINT INSPECTION REPORT - GOOD - REQUIRES ATTENTION
        """
    )

    assert parsed["date"] == date(2026, 7, 21)
    assert parsed["date_source"] == "R.O. Opened"
    assert "Technician scanned vehicle" in parsed["notes"]
    assert "customer states" not in parsed["notes"].lower()
    assert "multi-point" not in parsed["notes"].lower()
    assert "DEL. DATE" not in parsed["notes"]


def test_delivery_date_is_never_used_as_a_service_date_fallback():
    parsed = parse_maintenance_text(
        """
        DEL. DATE 30DEC25
        Vehicle received a multi-point inspection report.
        """,
        require_complete=False,
    )

    assert parsed["date"] is None
