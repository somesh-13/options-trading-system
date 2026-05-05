"""IR Data Scraper - Investor Relations page scraping for sentiment analysis.

Scrapes publicly available financial news and IR data using BeautifulSoup.
Extracts earnings call highlights, SEC filing summaries, and news headlines.
"""

import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional
import yfinance as yf
import re


def scrape_yahoo_news(ticker: str, max_articles: int = 10) -> list[dict]:
    """Scrape recent news headlines and summaries from Yahoo Finance.

    yfinance's `Ticker.news` shape changed in late 2025: every field now lives
    under `item["content"]` rather than at the top level, and the Unix-epoch
    `providerPublishTime` was replaced with an ISO-8601 `pubDate`. Read both
    layouts so older yfinance versions still work on machines that haven't
    upgraded yet.
    """
    try:
        stock = yf.Ticker(ticker)
        news = stock.news or []
        articles = []
        for item in news[:max_articles]:
            content = item.get("content") or {}
            # Fields can live either nested (new yfinance) or top-level (old).
            title = content.get("title") or item.get("title") or ""
            summary = content.get("summary") or content.get("description") or item.get("summary", "")
            content_type = content.get("contentType") or item.get("type", "STORY")
            published = content.get("pubDate") or content.get("displayTime") or item.get("providerPublishTime", 0)

            provider = content.get("provider") or {}
            publisher = (
                provider.get("displayName")
                or item.get("publisher")
                or ""
            )

            link_obj = (
                content.get("clickThroughUrl")
                or content.get("canonicalUrl")
                or {}
            )
            link = link_obj.get("url") if isinstance(link_obj, dict) else item.get("link") or ""

            articles.append({
                "title": title,
                "publisher": publisher,
                "link": link,
                "published": published,
                "summary": summary,
                "type": content_type,
                "related_tickers": item.get("relatedTickers") or content.get("finance", {}).get("stockTickers", []),
            })
        return articles
    except Exception:
        return []


def scrape_sec_filings(ticker: str, filing_types: list[str] = None) -> list[dict]:
    """Fetch recent SEC filings metadata from EDGAR."""
    if filing_types is None:
        filing_types = ["10-K", "10-Q", "8-K"]

    headers = {"User-Agent": "TradingDashboard/1.0 research@example.com"}
    filings = []

    try:
        # Get CIK from ticker
        url = f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&startdt={(datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')}&enddt={datetime.now().strftime('%Y-%m-%d')}&forms={','.join(filing_types)}"
        # Use EDGAR full-text search API
        search_url = f"https://efts.sec.gov/LATEST/search-index?q={ticker}&forms={','.join(filing_types)}&dateRange=custom&startdt={(datetime.now() - timedelta(days=180)).strftime('%Y-%m-%d')}&enddt={datetime.now().strftime('%Y-%m-%d')}"

        # Simpler approach: use EDGAR company search
        cik_url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={ticker}&type=&dateb=&owner=include&count=5&search_text=&action=getcompany&output=atom"
        resp = requests.get(cik_url, headers=headers, timeout=10)

        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            entries = soup.find_all("entry")
            for entry in entries[:5]:
                title = entry.find("title")
                updated = entry.find("updated")
                link = entry.find("link")
                filings.append({
                    "title": title.text if title else "",
                    "date": updated.text if updated else "",
                    "link": link.get("href", "") if link else "",
                    "type": "SEC_FILING",
                })
    except Exception:
        pass

    return filings


def get_company_info(ticker: str) -> dict:
    """Get company fundamental info for context."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info or {}
        return {
            "name": info.get("longName", ticker),
            "sector": info.get("sector", "Unknown"),
            "industry": info.get("industry", "Unknown"),
            "market_cap": info.get("marketCap", 0),
            "pe_ratio": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "earnings_date": str(info.get("earningsDate", "")),
            "recommendation": info.get("recommendationKey", ""),
            "target_price": info.get("targetMeanPrice"),
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
