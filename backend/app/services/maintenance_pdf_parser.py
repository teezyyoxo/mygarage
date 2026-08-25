"""Conservative field extraction for maintenance/service-record PDF text."""

from __future__ import annotations

import re
from datetime import date
from typing import Any


class MaintenancePdfParseError(ValueError):
    """A human-readable reason a PDF cannot become a maintenance record."""


def _lines(text: str) -> list[str]:
    cleaned: list[str] = []
    for raw in text.replace("\r", "\n").splitlines():
        line = re.sub(r"[ \t]+", " ", raw).strip(" |\t")
        if line and not re.fullmatch(r"[-_=.# ]{3,}", line):
            cleaned.append(line)
    return cleaned


def _date(value: str) -> date | None:
    match = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", value)
    if not match:
        return None
    month, day, year = map(int, match.groups())
    year += 2000 if year < 70 else 1900 if year < 100 else 0
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _first(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1).strip(" #:-")
    return None


def _shop(lines: list[str]) -> str | None:
    business = re.compile(
        r"\b(?:LLC|LTD|INC|MOTOR WORKS|MOTORS|AUTO|AUTOMOTIVE|SALES AND SERVICE|"
        r"BMW OF|TOYOTA|HONDA|FORD|CHEVROLET|DEALER|SERVICE CENTER)\b",
        re.IGNORECASE,
    )
    excluded = re.compile(r"invoice|customer|vehicle|repair order|payment", re.IGNORECASE)
    for line in lines[:35]:
        if 3 <= len(line) <= 100 and business.search(line) and not excluded.search(line):
            return line.title() if line.isupper() else line
    return None


def _service_lines(lines: list[str]) -> list[str]:
    noise = re.compile(
        r"^(?:invoice|customer|client|phone|email|vin|license|vehicle|odometer|mileage|"
        r"subtotal|grand total|total due|amount paid|balance due|tax|page \d+|payment|"
        r"repair order|r/?o\s*(?:number|#)|date)\b",
        re.IGNORECASE,
    )
    useful = re.compile(
        r"oil|filter|tire|tyre|brake|coolant|inspection|diagnos|replace|repair|service|"
        r"maintenance|rotate|alignment|battery|fluid|belt|spark|flush|installed|performed|"
        r"transmission|engine|air condition|a/?c\b",
        re.IGNORECASE,
    )
    result: list[str] = []
    for line in lines:
        candidate = re.sub(r"^[✓✔#\d.:-]+\s*", "", line).strip()
        candidate = re.sub(r"\s+\$?[\d,]+\.\d{2}(?:\s+\$?[\d,]+\.\d{2})*$", "", candidate)
        looks_like_business_name = re.search(
            r"\b(?:LLC|LTD|INC|MOTORS|AUTOMOTIVE|SERVICE CENTER)\b", candidate, re.I
        ) and not re.search(r"performed|replaced|repaired|serviced|installed", candidate, re.I)
        if (
            4 <= len(candidate) <= 500
            and useful.search(candidate)
            and not noise.search(candidate)
            and not looks_like_business_name
            and candidate not in result
        ):
            result.append(candidate)
    return result[:40]


def parse_maintenance_text(text: str) -> dict[str, Any]:
    """Extract enough trustworthy data to create one service visit."""
    lines = _lines(text)
    if len("".join(lines)) < 40:
        raise MaintenancePdfParseError(
            "No usable text was extracted. This is usually an image-only scan; "
            "OCR may be unavailable or the scan may be too faint."
        )
    normalized = "\n".join(lines)

    service_date = None
    close_date_pair = re.search(
        r"R/?O Close Date\s+Status\s*\n\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
        normalized,
        re.IGNORECASE,
    )
    if close_date_pair:
        service_date = _date(close_date_pair.group(1))
    for pattern in (
        r"R/?O Close Date\s*:?\s*([^\n]+)",
        r"Invoice Date\s*:?\s*([^\n]+)",
        r"Service Date\s*:?\s*([^\n]+)",
        r"Date Created\s*:?\s*([^\n]+)",
        r"Paid on\s+([^\n]+)",
    ):
        if not service_date:
            match = re.search(pattern, normalized, re.IGNORECASE)
            if match and (service_date := _date(match.group(1))):
                break
    if not service_date:
        service_date = next((_date(line) for line in lines[:45] if _date(line)), None)
    if not service_date:
        raise MaintenancePdfParseError(
            "Maintenance details were found, but no recognizable service date was present."
        )

    mileage_pair = re.search(
        r"Mileage In\s+Mileage Out\s*\n\s*([\d,]+)\s+[\d,]+",
        normalized,
        re.IGNORECASE,
    )
    mileage_match = None if mileage_pair else re.search(
        r"(?:odometer(?: mileage)?|mileage(?: in| out)?)\s*:?\s*([\d,]+)\s*(km|mi|miles)?",
        normalized,
        re.IGNORECASE,
    )
    mileage_text = mileage_pair.group(1) if mileage_pair else None
    if mileage_text is None and mileage_match:
        mileage_text = mileage_match.group(1)
    mileage = int(mileage_text.replace(",", "")) if mileage_text else None
    mileage_unit = (mileage_match.group(2) or "mi").lower() if mileage_match else None
    if mileage_pair:
        mileage_unit = "mi"

    total = None
    for pattern in (
        r"Grand Total\s*:?\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})",
        r"Total Due\s*:?\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})",
        r"Amount Paid\s*:?\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})",
    ):
        matches = re.findall(pattern, normalized, re.IGNORECASE)
        if matches:
            total = float(matches[-1].replace(",", ""))
            break

    work = _service_lines(lines)
    if not work:
        raise MaintenancePdfParseError(
            "Text was extracted, but no recognizable maintenance or repair work was found."
        )
    joined_work = " ".join(work)
    labels = [
        ("Oil service", r"oil|oil filter"),
        ("Brake service", r"brake|rotor|caliper"),
        ("Tire service", r"tire|tyre|rotation|alignment"),
        ("Inspection / diagnostic", r"inspection|diagnos|vehicle scan"),
        ("Cooling system service", r"coolant|radiator|water pump"),
        ("Scheduled maintenance", r"maintenance|service performed"),
    ]
    detected = [label for label, pattern in labels if re.search(pattern, joined_work, re.I)]

    paired_invoice = re.search(
        r"R/?O Open Date\s+R/?O Number\s*\n\s*"
        r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+([A-Z0-9-]+)",
        normalized,
        re.IGNORECASE,
    )
    invoice_number = paired_invoice.group(1) if paired_invoice else _first(
        normalized,
        [
            r"Invoice\s*(?:ID|Number|No\.?|#)\s*[:#]?\s*([A-Z0-9-]+)",
            r"\bR/?O\s*(?:Number|#)\s*:?\s*([A-Z0-9-]+)",
        ],
    )

    return {
        "date": service_date,
        "mileage": mileage,
        "mileage_unit": mileage_unit,
        "total_cost": total,
        "description": " / ".join(detected[:2]) or work[0][:200],
        "notes": "\n".join(work),
        "shop": _shop(lines),
        "invoice_number": invoice_number,
    }
