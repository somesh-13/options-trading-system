"""IR Data Scraper - Investor Relations page scraping for sentiment analysis.

Scrapes publicly available financial news and IR data using BeautifulSoup.
Extracts earnings call highlights, SEC filing summaries, and news headlines.
"""

from datetime import datetime

from data.market_provider import (
    get_company_info as _provider_company_info,
    get_news as _provider_news,
)


def scrape_yahoo_news(ticker: str, max_articles: int = 10) -> list[dict]:
    """Recent news headlines + summaries via the market provider.

    The provider's `get_news` already handles yfinance's late-2025 shape change
    (fields nested under `content.*`) and normalizes to NewsItem objects. We
    project those back to the dict shape downstream callers expect.
    """
    try:
        items = _provider_news(ticker, limit=max_articles)
        articles = []
        for n in items:
            published_raw: object = ""
            if n.published_at is not None:
                published_raw = n.published_at.isoformat()
            articles.append({
                "title": n.title,
                "publisher": n.publisher or "",
                "link": n.url or "",
                "published": published_raw,
                "summary": n.summary or "",
                "type": "STORY",
                "related_tickers": [],
            })
        return articles
    except Exception:
        return []


def scrape_sec_filings(ticker: str, filing_types: list[str] = None) -> list[dict]:
    """Fetch recent SEC filings via the EDGAR submissions API.

    For 8-Ks, also attaches `body_excerpt` populated from exhibit 99.1 (the
    earnings press release). Bodies are disk-cached, so only the first refresh
    per filing pays the network cost.
    """
    if filing_types is None:
        filing_types = ["10-K", "10-Q", "8-K"]

    try:
        from data.sec_exhibits import scrape_filings_with_bodies  # type: ignore
        return scrape_filings_with_bodies(ticker, forms=tuple(filing_types), limit=10)
    except Exception:
        return []


def get_company_info(ticker: str) -> dict:
    """Get company fundamental info for context (provider-backed)."""
    try:
        company = _provider_company_info(ticker)
        info = company.raw or {}
        return {
            "name": company.long_name or ticker,
            "sector": company.sector or "Unknown",
            "industry": company.industry or "Unknown",
            "market_cap": company.market_cap or 0,
            "pe_ratio": company.trailing_pe,
            "forward_pe": company.forward_pe,
            "earnings_date": str(info.get("earningsDate", "")),
            "recommendation": info.get("recommendationKey", ""),
            "target_price": company.target_mean_price,
            "current_price": info.get("currentPrice", info.get("regularMarketPrice")),
            "52w_high": info.get("fiftyTwoWeekHigh"),
            "52w_low": info.get("fiftyTwoWeekLow"),
        }
    except Exception:
        return {"name": ticker, "sector": "Unknown", "industry": "Unknown"}


def aggregate_ir_data(ticker: str) -> dict:
    """Aggregate all IR data sources for a ticker."""
    news = scrape_yahoo_news(ticker)
    filings = scrape_sec_filings(ticker)
    company = get_company_info(ticker)

    return {
        "ticker": ticker,
        "company": company,
        "news": news,
        "filings": filings,
        "data_sources": ["yahoo_finance", "sec_edgar"],
        "timestamp": datetime.now().isoformat(),
        "article_count": len(news),
        "filing_count": len(filings),
    }
