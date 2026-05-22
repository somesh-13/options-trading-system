"""Critical-alert notification service.

Surfaces actionable signals derived from the user's live Robinhood book and
the existing scanner mispricing endpoint:

  * `high_iv`         — IV / HV ratio severely elevated on a portfolio ticker.
  * `cc_opportunity`  — user holds the shares; IV is rich enough to justify
                        writing a covered call.
  * `csp_opportunity` — IV is rich enough to size a cash-secured put on a
                        watchlist name (stub in v1).

Persisted in `backend/trades.db` (`notifications` table); deduped per
``(ticker, alert_type, severity)`` while an undismissed copy exists.
"""

from .service import scan_now, list_active, dismiss

__all__ = ["scan_now", "list_active", "dismiss"]
