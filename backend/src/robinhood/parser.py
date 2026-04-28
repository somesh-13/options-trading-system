"""Parse Robinhood activity CSV rows and option descriptions."""

from __future__ import annotations

import csv
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional


@dataclass
class ActivityRow:
    row_hash: str
    activity_date: str  # ISO yyyy-mm-dd
    process_date: Optional[str]
    settle_date: Optional[str]
    instrument: Optional[str]
    description: Optional[str]
    trans_code: str
    quantity: Optional[float]
    price: Optional[float]
    amount: Optional[float]
    source_file: str


@dataclass
class OptionLeg:
    underlying: str
    expiry: str  # ISO yyyy-mm-dd
    side: str    # 'Call' or 'Put'
    strike: float


_MONEY_RE = re.compile(r"[^0-9.\-]")


def _parse_money(raw: str) -> Optional[float]:
    s = (raw or "").strip()
    if not s:
        return None
    negative = s.startswith("(") and s.endswith(")")
    clean = _MONEY_RE.sub("", s)
    if clean in ("", "-", "."):
        return None
    try:
        val = float(clean)
    except ValueError:
        return None
    return -val if negative else val


def _parse_number(raw: str) -> Optional[float]:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _parse_date(raw: str) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _compute_row_hash(
    activity_date: str,
    trans_code: str,
    instrument: str,
    quantity: Optional[float],
    price: Optional[float],
    amount: Optional[float],
    description: str,
) -> str:
    parts = [
        activity_date,
        trans_code,
        instrument or "",
        f"{quantity:.6f}" if quantity is not None else "",
        f"{price:.6f}" if price is not None else "",
        f"{amount:.6f}" if amount is not None else "",
        (description or "").strip(),
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def iter_activity_rows(csv_path: Path) -> Iterator[ActivityRow]:
    """Yield one ActivityRow per valid data row in the CSV.

    Skips header, blank trailers, and the footer disclaimer row that Robinhood
    appends (identified by an empty Trans Code + the word 'informational' in
    any column).
    """
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        expected = [
            "Activity Date", "Process Date", "Settle Date", "Instrument",
            "Description", "Trans Code", "Quantity", "Price", "Amount",
        ]
        if header is None or [h.strip() for h in header[:9]] != expected:
            raise ValueError(f"Unexpected CSV header in {csv_path}: {header}")

        for raw in reader:
            # Pad short rows, trim overflow.
            row = (raw + [""] * 9)[:9]
            activity_date_raw, process_date_raw, settle_date_raw, instrument, \
                description, trans_code, quantity_raw, price_raw, amount_raw = row

            trans_code = (trans_code or "").strip()
            if not trans_code:
                # Footer / blank line.
                continue

            activity_date = _parse_date(activity_date_raw)
            if not activity_date:
                continue

            process_date = _parse_date(process_date_raw)
            settle_date = _parse_date(settle_date_raw)
            quantity = _parse_number(quantity_raw)
            price = _parse_money(price_raw)
            amount = _parse_money(amount_raw)
            instrument = (instrument or "").strip() or None
            description = (description or "").strip()

            row_hash = _compute_row_hash(
                activity_date, trans_code, instrument or "",
                quantity, price, amount, description,
            )
            yield ActivityRow(
                row_hash=row_hash,
                activity_date=activity_date,
                process_date=process_date,
                settle_date=settle_date,
                instrument=instrument,
                description=description or None,
                trans_code=trans_code,
                quantity=quantity,
                price=price,
                amount=amount,
                source_file=csv_path.name,
            )


# e.g. "RDW 5/15/2026 Call $15.00"  or  "NOW 1/15/2027 Put $150.00"
_OPTION_RE = re.compile(
    r"^([A-Z][A-Z0-9.\-]*)\s+"
    r"(\d{1,2}/\d{1,2}/\d{2,4})\s+"
    r"(Call|Put)\s+"
    r"\$([\d,]+(?:\.\d+)?)\s*$",
    re.IGNORECASE,
)


def parse_option_description(description: Optional[str]) -> Optional[OptionLeg]:
    if not description:
        return None
    m = _OPTION_RE.match(description.strip())
    if not m:
        return None
    underlying, expiry_raw, side, strike_raw = m.groups()
    expiry = _parse_date(expiry_raw)
    if not expiry:
        return None
    try:
        strike = float(strike_raw.replace(",", ""))
    except ValueError:
        return None
    return OptionLeg(
        underlying=underlying.upper(),
        expiry=expiry,
        side=side.capitalize(),
        strike=strike,
    )
