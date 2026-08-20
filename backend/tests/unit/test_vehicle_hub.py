from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.routes.vehicle_hub import _category, _date, _decimal, _fingerprint, _notes
from app.routes.vehicle_hub_ui import _normalize_command_url


def test_command_record_mapping_is_bounded_and_stable():
    source = {
        "date": "2026-08-17",
        "mileage": 91000,
        "type": "Inspection",
        "notes": "TEST",
        "shop": "Self/DIY",
        "invoiceNumber": "RO-22",
    }

    assert _date(source["date"]).isoformat() == "2026-08-17"
    assert _decimal(source["mileage"]) == Decimal("91000")
    assert _category(source["type"]) == "Inspection"
    assert _notes(source) == "TEST\nProvider: Self/DIY\nInvoice / RO: RO-22"
    assert _fingerprint(source) == _fingerprint(dict(reversed(list(source.items()))))


def test_unknown_category_falls_back_without_accepting_invalid_schema_value():
    assert _category("Oil service") == "Maintenance"
    assert _category("Pre-purchase inspection") == "Inspection"


def test_invalid_source_date_is_rejected():
    with pytest.raises(HTTPException, match="YYYY-MM-DD"):
        _date("not-a-date")


def test_command_url_requires_an_explicit_port_and_safe_origin_shape():
    assert (
        _normalize_command_url("http://deskmini.local:5300/")
        == "http://deskmini.local:5300"
    )
    with pytest.raises(HTTPException, match="explicit port"):
        _normalize_command_url("http://deskmini.local")
    with pytest.raises(HTTPException, match="credentials"):
        _normalize_command_url("http://user:secret@deskmini.local:5300")
