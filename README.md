# Trading Dashboard

A Next.js dashboard for monitoring paper trading performance via Alpaca API.

## Features

- 📊 Real-time portfolio stats (value, equity, cash, buying power)
- 📈 Performance chart with time-period filters
- 📋 Live trades table with filtering (All/Filled/Open)
- 🎨 Robinhood-inspired dark theme
- ⚡ Built with Next.js 14, TypeScript, and Tailwind CSS

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create `.env.local` file:

```env
ALPACA_API_KEY=your_api_key_here
ALPACA_SECRET_KEY=your_secret_key_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── portfolio/route.ts    # Portfolio stats API
│   │   ├── positions/route.ts    # Current positions API
│   │   └── trades/route.ts       # Trade history API
│   └── page.tsx                  # Main dashboard page
├── components/
│   ├── PortfolioStats.tsx        # Portfolio stats cards
│   ├── TradesTable.tsx           # Trades table with filters
│   └── PerformanceChart.tsx      # Portfolio performance chart
└── lib/
    └── alpaca.ts                 # Alpaca API client
```

## API Routes

### GET /api/portfolio
Returns portfolio stats: value, equity, cash, buying power, and daily P&L.

### GET /api/positions
Returns all current positions from Alpaca.

### GET /api/trades?limit=50
Returns recent trade history with optional limit parameter.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Charts:** Chart.js + react-chartjs-2
- **API:** Alpaca Trade API SDK
- **Date Formatting:** date-fns

## Next Steps

1. ✅ Basic dashboard layout
2. ✅ Alpaca API integration
3. ✅ Portfolio stats cards
4. ✅ Trades table with filters
5. ✅ Performance chart
6. ⏳ Add cron job for automated trade monitoring
7. ⏳ Implement backtesting metrics
8. ⏳ Add options strike display (e.g., "CIFR $15.50 CALL - Sold")
9. ⏳ Database integration for historical data
10. ⏳ Deploy to production

## License

MIT
