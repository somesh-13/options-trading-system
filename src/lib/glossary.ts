export type GlossaryCategory =
  | 'greeks'
  | 'risk'
  | 'vol'
  | 'options'
  | 'portfolio'
  | 'strategy'
  | 'metrics';

export interface GlossaryEntry {
  term: string;
  category: GlossaryCategory;
  /** 1–2 sentence plain-English explanation, no jargon. ELI10. */
  simple: string;
  /** 2–4 sentence deeper explanation with a bit of jargon. */
  detail: string;
  formula?: string;
  example?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ── Greeks ────────────────────────────────────────────────────────────────
  delta: {
    term: 'Delta',
    category: 'greeks',
    simple:
      "Delta tells you how much your option's price changes when the stock moves by $1. Think of it like a speedometer — a delta of 0.5 means if the stock goes up $1, your option goes up about $0.50.",
    detail:
      'Delta ranges from 0 to 1 for calls and −1 to 0 for puts. At-the-money options have a delta near ±0.50. Deep in-the-money options approach ±1, meaning they move nearly dollar-for-dollar with the stock. Delta also approximates the probability that the option expires in-the-money.',
    formula: 'Δ = ∂V / ∂S',
    example: 'A call with Δ = 0.40 gains ~$40 in value when the stock rises $1 (per 100-share contract).',
  },
  gamma: {
    term: 'Gamma',
    category: 'greeks',
    simple:
      "Gamma is the delta's rate of change — it shows how fast your delta is moving as the stock price moves. A high gamma means your option is very sensitive; small stock moves can dramatically change how reactive your option is.",
    detail:
      'Gamma is highest for at-the-money options close to expiration. Long options (bought calls/puts) have positive gamma, which is generally favourable. Short options have negative gamma, meaning you can get hurt quickly if the stock makes a big move.',
    formula: 'Γ = ∂Δ / ∂S = ∂²V / ∂S²',
    example: 'If Δ = 0.50 and Γ = 0.05, a $1 stock move makes delta 0.55 (or 0.45).',
  },
  vega: {
    term: 'Vega',
    category: 'greeks',
    simple:
      "Vega is like a sail — the more wind (volatility) blows, the more your option moves. It measures how much your option's price changes when the market's expected swinginess goes up by 1%.",
    detail:
      "Vega is expressed in dollars per 1% change in implied volatility. All long options have positive vega — they gain value when volatility rises. Short options have negative vega. Vega is largest for at-the-money options with lots of time remaining, and shrinks as expiration approaches.",
    formula: 'ν = ∂V / ∂σ',
    example: 'A vega of 0.12 means the option gains $0.12 per 100-share contract for every 1% rise in IV.',
  },
  theta: {
    term: 'Theta',
    category: 'greeks',
    simple:
      "Theta is the daily cost of holding an option — like a parking meter ticking away. Every day that passes, your option loses a little value even if the stock doesn't move. Sellers love theta; buyers fight it.",
    detail:
      "Theta is negative for long options (you're paying time decay) and positive for short options (you're collecting it). It accelerates as expiration approaches — an option loses much more value in its final week than in week one. Theta and vega are natural opposites: high vega days are usually high theta days too.",
    formula: 'Θ = ∂V / ∂t  (usually negative for long positions)',
    example: 'Θ = −0.05 means the option loses $0.05 in value each calendar day, all else equal.',
  },
  rho: {
    term: 'Rho',
    category: 'greeks',
    simple:
      "Rho measures how much your option's price changes if interest rates go up or down by 1%. It's usually the least important Greek for short-dated options but matters more for multi-year options (LEAPs).",
    detail:
      'Rho is positive for long calls and negative for long puts — higher rates generally benefit calls and hurt puts, because carrying cash has a higher opportunity cost. For most retail traders rho is a minor concern, but in a rising-rate environment it can move option prices meaningfully for longer-dated contracts.',
    formula: 'ρ = ∂V / ∂r',
    example: 'A LEAP call with ρ = 0.15 gains $0.15 in value if rates rise 1%.',
  },
  vanna: {
    term: 'Vanna',
    category: 'greeks',
    simple:
      "Vanna measures the interaction between price moves and volatility — specifically, how delta changes when volatility changes (or how vega changes when the stock price changes). It's a second-order Greek that becomes important when both the stock and volatility are moving at the same time.",
    detail:
      'Vanna is the cross-partial derivative ∂Δ/∂σ = ∂ν/∂S. It is positive for out-of-the-money calls and in-the-money puts. Dealers hedge vanna exposure because during volatility spikes the delta of their books can shift significantly, forcing rapid re-hedging.',
    formula: 'Vanna = ∂Δ/∂σ = ∂²V/(∂S ∂σ)',
  },
  charm: {
    term: 'Charm',
    category: 'greeks',
    simple:
      "Charm shows how your delta will change as one more day passes. Think of it as the daily drift of your delta — useful if you're delta-hedging and want to know how much your hedge will drift overnight.",
    detail:
      'Charm is the cross-partial derivative ∂Δ/∂t. For long calls it is typically negative (delta drifts toward 0 over time for OTM options) and for long puts it is positive. Traders who run delta-neutral books use charm to forecast tomorrow\'s delta before the market opens.',
    formula: 'Charm = ∂Δ/∂t = ∂²V/(∂S ∂t)',
  },
  volga: {
    term: 'Volga (Vomma)',
    category: 'greeks',
    simple:
      "Volga measures how much vega itself changes when volatility changes — it's the acceleration of your option's sensitivity to volatility. High volga means your option gets a lot more (or less) vega-sensitive as vol moves.",
    detail:
      'Volga (also called vomma) is ∂ν/∂σ = ∂²V/∂σ². Long options have positive volga — if implied volatility rises a lot, your vega also increases, compounding the gain. This is why buying options in a low-vol environment can be particularly profitable if a vol spike follows.',
    formula: 'Volga = ∂ν/∂σ = ∂²V/∂σ²',
  },

  // ── Risk ──────────────────────────────────────────────────────────────────
  var: {
    term: 'VaR (Value at Risk)',
    category: 'risk',
    simple:
      "VaR answers: 'How much money could I lose on a really bad day?' A 95% VaR of $1,000 means that 95% of trading days you should lose no more than $1,000 — but on the worst 5% of days you could lose more.",
    detail:
      "VaR is calculated three common ways: Historical (look at past returns), Parametric (assume a normal distribution), or Monte Carlo (simulate thousands of scenarios). The 95% and 99% confidence levels are most common. VaR doesn't tell you how bad the worst days are — just the threshold.",
    example: '95% 1-day VaR of $800 means you expect to lose ≤ $800 on 19 out of 20 trading days.',
  },
  drawdown: {
    term: 'Drawdown',
    category: 'risk',
    simple:
      "Drawdown is how far your portfolio has fallen from its highest point. If your account hit $10,000 at its best and is now at $8,500, you have a 15% drawdown — like a dip from a mountain peak.",
    detail:
      'Drawdown is typically expressed as a percentage from the most recent high-water mark. It is not the same as a loss from your original investment — it measures the decline from the peak value. Tracking drawdown helps you understand the pain of being in a strategy during its worst stretches.',
    formula: 'DD = (Peak − Current) / Peak × 100%',
    example: 'Peak NAV $12,000, current NAV $10,200 → drawdown = 15%.',
  },
  'max-drawdown': {
    term: 'Max Drawdown',
    category: 'risk',
    simple:
      "Max drawdown is the single worst peak-to-valley drop your portfolio ever experienced. It answers: 'In the worst possible stretch, how much did I lose before recovering?' Lower is better.",
    detail:
      "Max drawdown (MDD) is the largest percentage decline from any peak to the subsequent trough over a given period. It's a key metric for evaluating strategy risk — a strategy with a 40% MDD requires a 67% gain just to recover. Calmar ratio divides annual return by MDD.",
    formula: 'MDD = max over t of [(Peak_t − Trough_t) / Peak_t]',
  },
  'stress-test': {
    term: 'Stress Test',
    category: 'risk',
    simple:
      "A stress test asks: 'What happens to my portfolio if the stock crashes 10% or volatility spikes 20%?' It's like running a fire drill — you simulate a disaster scenario to see how bad the damage would be.",
    detail:
      "Stress tests apply predefined shocks to market variables (spot price, implied vol, interest rates) and re-price every position. The output is the hypothetical P&L under that scenario. Common shocks include ±10% spot, ±20% vol, or historical crisis scenarios like March 2020.",
  },
  'position-limits': {
    term: 'Position Limits',
    category: 'risk',
    simple:
      "Position limits are guardrails on how big any single bet can get. They prevent you from accidentally putting too much money on one trade — like a safety cap so no single bad call sinks the ship.",
    detail:
      "Position limits are typically defined as a maximum percentage of portfolio NAV allocated to any single ticker, sector, or Greek exposure. When a limit is breached the risk system flags it as a WARNING or VIOLATION. Respecting limits forces diversification and reduces tail risk.",
  },
  'hedge-ratio': {
    term: 'Hedge Ratio',
    category: 'risk',
    simple:
      "The hedge ratio tells you how many shares of stock you'd need to buy or sell to make your options portfolio delta-neutral — meaning it would barely move if the stock price ticked up or down a little.",
    detail:
      "A delta-neutral hedge means total portfolio delta ≈ 0. If your options give you a net delta of +50, you'd short 50 shares of the underlying to neutralise it. The hedge ratio shows the direction (BUY/SELL) and quantity. Perfect neutrality is never maintained; traders re-hedge when delta drifts beyond a threshold.",
    formula: 'Hedge shares = −(Portfolio Δ) / (Δ per share)',
  },
  rebalance: {
    term: 'Rebalance',
    category: 'risk',
    simple:
      "Rebalancing means adjusting your positions to bring your risk metrics (Greeks, allocations) back inside their target ranges. Like tidying up a messy desk — you restore order when things drift too far from plan.",
    detail:
      "Rebalance triggers fire when a Greek (delta, gamma, vega) or allocation drifts beyond a predefined band. The severity rating (LOW / MEDIUM / HIGH / CRITICAL) indicates urgency. Frequent rebalancing reduces risk but increases transaction costs; the art is choosing a band wide enough to avoid over-trading.",
  },
  sharpe: {
    term: 'Sharpe Ratio',
    category: 'risk',
    simple:
      "The Sharpe ratio tells you how much return you're getting for each unit of risk you're taking. A higher Sharpe is better — 1.0 is decent, 2.0 is great, 3.0+ is exceptional.",
    detail:
      'Sharpe ratio = (Portfolio return − Risk-free rate) / Portfolio standard deviation. It penalises volatile strategies that earn the same return as steadier ones. A negative Sharpe means you would have done better holding cash. Sharpe is annualised and assumes returns are roughly normally distributed.',
    formula: 'Sharpe = (R_p − R_f) / σ_p',
    example: 'Annual return 18%, risk-free rate 4.5%, volatility 10% → Sharpe = (18−4.5)/10 = 1.35.',
  },
  calmar: {
    term: 'Calmar Ratio',
    category: 'risk',
    simple:
      "Calmar ratio divides your annual return by your worst drawdown. It answers: 'Is the return worth the pain of the worst dip?' A Calmar of 1.0 means you earned as much as your worst loss.",
    detail:
      'Calmar = Annualised Return / |Max Drawdown|. A Calmar above 1 is generally considered good. It is preferred over Sharpe in trend-following and options strategies where return distributions are skewed or have fat tails, because it focuses on the worst-case loss rather than average volatility.',
    formula: 'Calmar = Annualised Return / |Max Drawdown|',
  },

  // ── Volatility ────────────────────────────────────────────────────────────
  'implied-vol': {
    term: 'Implied Volatility (IV)',
    category: 'vol',
    simple:
      "Implied volatility is the market's best guess at how wild the stock price will be in the future. High IV means options are expensive because traders expect big swings; low IV means cheaper options and a calmer expected market.",
    detail:
      "IV is derived by working backward from an option's market price using an options pricing model like Black-Scholes. It's expressed as an annualised percentage. IV is forward-looking — it reflects the crowd's fear and greed. It often spikes before earnings, FDA decisions, or macro events.",
    formula: 'Solve: Market Price = BS(S, K, T, r, σ) for σ',
    example: 'IV = 60% means the market expects moves of roughly ±60% annualised (or ~3.8% per day).',
  },
  'historical-vol': {
    term: 'Historical Volatility (HV)',
    category: 'vol',
    simple:
      "Historical volatility measures how much the stock actually has moved in the past, using real price data. It's the rear-view mirror; implied vol is the windshield. Comparing them tells you if options are cheap or expensive.",
    detail:
      "HV is computed as the annualised standard deviation of daily log-returns over a trailing window (commonly 20 or 30 days). Unlike IV, it looks backward, not forward. It provides a baseline for whether the market is demanding more (or less) premium than the stock has historically justified.",
    formula: 'HV = σ_daily × √252  where σ_daily = std(log(S_t / S_{t-1}))',
    example: '30-day HV of 45% means the stock moved about 45% annualised over the past month.',
  },
  'iv-hv': {
    term: 'IV/HV Ratio',
    category: 'vol',
    simple:
      "The IV/HV ratio compares what the market expects volatility to be (IV) vs. what it actually was recently (HV). A ratio above 1 means options are expensive relative to past moves — a signal to consider selling. Below 1 means options are cheap — a signal to consider buying.",
    detail:
      "IV/HV > 1.2 is often used as a threshold for volatility-selling strategies (sell premium). IV/HV < 0.8 can signal an opportunity to buy options cheaply. The ratio is the core mispricing signal in volatility arbitrage strategies like the wheel. Ratios should be interpreted alongside the regime — high-IV regimes can persist.",
    example: 'IV = 72%, HV = 48% → IV/HV = 1.50 → options are expensive; vol selling is attractive.',
  },
  'iv-smile': {
    term: 'IV Smile / Skew',
    category: 'vol',
    simple:
      "If you plotted IV vs. strike price, you'd expect a flat line — but in reality it curves like a smile (or a smirk). This tells you which strikes are more expensive relative to others, usually because traders fear big crashes more than big rallies.",
    detail:
      "In equity markets the 'smile' is really a skew: lower strikes have higher IV than higher strikes, because investors buy puts as portfolio insurance, driving up their implied vol. A true symmetric smile appears in currency markets. The volatility surface extends the smile across expiration dates.",
    example: 'A 90% put might have IV = 85% while a 110% call has IV = 50% on the same stock.',
  },
  regime: {
    term: 'Market Regime',
    category: 'vol',
    simple:
      "A regime is the current 'mood' of the market — is it calm and trending up, choppy with sideways action, or panicking? Knowing the regime helps you pick strategies that fit the current environment rather than fighting it.",
    detail:
      "Regime detection (often using Hidden Markov Models or clustering) classifies recent price and volatility data into states like 'LOW_VOL_BULL', 'HIGH_VOL_BEAR', or 'CRASH'. Each regime has different optimal strategies — for example, selling premium works well in low-vol regimes but is dangerous heading into crashes.",
  },
  'hv-confidence': {
    term: 'HV Confidence Interval',
    category: 'vol',
    simple:
      "A confidence interval around historical volatility is a range saying: 'We're 95% sure the true volatility is between X% and Y%.' A wide interval means we're uncertain; a narrow one means the estimate is reliable.",
    detail:
      "HV is estimated from a finite sample of returns, so it carries statistical uncertainty. Bootstrapping or asymptotic formulas produce a confidence interval. When the interval is wide, the HV estimate is noisy and less reliable for trading decisions. The 'reliable' flag turns false when sample size is too small.",
    example: 'HV = 48% [CI: 38%–62%] — wide interval suggests the 48% estimate could easily be 20 points off.',
  },

  // ── Options ───────────────────────────────────────────────────────────────
  strike: {
    term: 'Strike Price',
    category: 'options',
    simple:
      "The strike price is the agreed price at which you can buy (call) or sell (put) the stock if you exercise your option. Think of it as the 'locked-in price' printed on your option contract.",
    detail:
      "Every option contract specifies a strike price. For a call, you want the stock to trade above the strike; for a put, below it. The distance between current stock price and strike determines whether an option is in-, at-, or out-of-the-money.",
    example: 'Buying a $50 call on a stock trading at $48 gives you the right to buy at $50.',
  },
  expiry: {
    term: 'Expiration / DTE',
    category: 'options',
    simple:
      "Every option has an expiry date — the last day you can use it. DTE (Days To Expiration) is simply how many calendar days are left. After expiry, the option either has value (it's in the money) or it doesn't (it expires worthless).",
    detail:
      "Shorter DTE means faster time decay (theta) but less time for the underlying to make a big move. Longer DTE (like LEAPs) gives the trade more time to work but costs more premium. Weekly options expire every Friday; standard monthly options expire the third Friday of each month.",
    example: 'An option expiring in 21 days has DTE = 21.',
  },
  itm: {
    term: 'In The Money (ITM)',
    category: 'options',
    simple:
      "An option is in-the-money when it already has real value if you exercised it right now. A call is ITM when the stock is above the strike; a put is ITM when the stock is below the strike.",
    detail:
      "An ITM option's price is composed of intrinsic value (how far in the money it is) plus time value. Deep ITM options behave most like the stock itself (delta near ±1). They cost more to buy but are less likely to expire worthless.",
    example: 'A $45 call when the stock is at $48 is $3 in the money (ITM).',
  },
  atm: {
    term: 'At The Money (ATM)',
    category: 'options',
    simple:
      "At-the-money means the strike price is right at (or very close to) the current stock price. ATM options are the most liquid and have the highest time value relative to their price.",
    detail:
      "ATM options have a delta of approximately ±0.50, the highest gamma, and the most time value. They are very sensitive to changes in both price and volatility. Options sellers often target ATM or near-ATM strikes to collect maximum premium.",
  },
  otm: {
    term: 'Out of The Money (OTM)',
    category: 'options',
    simple:
      "Out-of-the-money means the option has no intrinsic value yet — the stock hasn't reached the strike. OTM options are cheaper to buy, but they need a bigger move in the stock to pay off.",
    detail:
      "OTM options consist entirely of time value. They have lower deltas (further from ±0.50) and therefore require a larger stock move to become profitable. They are commonly sold in cash-secured put and covered call strategies for income.",
    example: 'A $55 call when the stock is at $48 is $7 out of the money (OTM).',
  },
  put: {
    term: 'Put Option',
    category: 'options',
    simple:
      "A put is like insurance on a stock. Buying a put gives you the right to sell shares at the strike price, no matter how low the stock falls. It goes up in value when the stock falls.",
    detail:
      "A long put profits when the underlying falls below the strike before expiration. It provides a floor on losses for stockholders. Selling a put (cash-secured put or CSP) obligates you to buy the shares at the strike — you collect premium but take on potential downside.",
  },
  call: {
    term: 'Call Option',
    category: 'options',
    simple:
      "A call gives you the right to buy shares at the strike price, even if the stock has gone way above it. It goes up in value when the stock rises.",
    detail:
      "A long call profits when the underlying rises above the strike before expiration. Selling a covered call means you already own the shares and agree to sell them at the strike if assigned — you collect premium but cap your upside.",
  },
  premium: {
    term: 'Premium',
    category: 'options',
    simple:
      "Premium is the price you pay to buy an option contract. Think of it like the cost of the ticket to the show — you pay it upfront, and if the show is bad (option expires worthless), you lose your ticket price.",
    detail:
      "Option premium consists of intrinsic value (how much it's in the money) plus time value (how much traders think it could move before expiry). Premium is quoted per share, and one standard contract covers 100 shares. IV is the biggest driver of time value — higher IV means higher premium.",
    example: 'A premium of $2.50 per share = $250 total for one 100-share contract.',
  },
  long: {
    term: 'Long (Bought)',
    category: 'options',
    simple:
      "Going 'long' means you bought something and you own it — you paid cash upfront for the right. If you're long a call, you want the stock to go up. If you're long a put, you want the stock to go down.",
    detail:
      "Long options have defined maximum loss (the premium paid) and theoretically unlimited upside (for calls). You are long vega (benefit from rising vol) and long gamma (benefit from big moves). The enemy of a long option is time decay (negative theta).",
  },
  short: {
    term: 'Short (Sold)',
    category: 'options',
    simple:
      "Going 'short' means you sold an option to someone else and collected the premium. You're now on the hook if things go against you. Short options make money when the stock stays calm and options expire worthless.",
    detail:
      "Short options have capped upside (the premium collected) but potentially large or unlimited losses. You are short vega (hurt by rising vol) and short gamma (hurt by large moves). You benefit from time decay — theta works in your favour.",
  },
  leap: {
    term: 'LEAP',
    category: 'options',
    simple:
      "A LEAP (Long-term Equity AnticiPation Security) is just an option with more than a year until expiration. They're used like a cheap substitute for owning shares — you get most of the upside with less capital at risk.",
    detail:
      "LEAPs are typically options with 1–3 years to expiration. Their longer time horizon reduces theta decay (relatively), makes them more sensitive to interest rates (higher rho), and allows directional bets without tying up full share-purchase capital. Deep ITM LEAPs can closely simulate stock ownership.",
  },

  // ── Portfolio ─────────────────────────────────────────────────────────────
  nav: {
    term: 'NAV (Net Asset Value)',
    category: 'portfolio',
    simple:
      "NAV is the total real-time value of everything you own in the account — the sum of all your positions at current market prices plus any cash. It's the true 'size' of your portfolio right now.",
    detail:
      "NAV = Total Market Value of positions + Cash. It changes with every price tick. NAV is the denominator used in return calculations: if NAV goes from $10,000 to $11,000, you earned a 10% return.",
  },
  'cost-basis': {
    term: 'Cost Basis',
    category: 'portfolio',
    simple:
      "Cost basis is how much you originally paid for your investments — the total money you put in. The difference between cost basis and current market value is your unrealized gain or loss.",
    detail:
      "Cost basis includes the purchase price of every share or option plus any commissions paid. For a portfolio of multiple purchases, it is the weighted-average price per share across all buys. The IRS uses cost basis to calculate capital gains taxes when you sell.",
    example: 'Bought 100 shares at $40 and 50 at $44 → cost basis = $42 per share (average).',
  },
  'unrealized-pnl': {
    term: 'Unrealized P&L',
    category: 'portfolio',
    simple:
      "Unrealized P&L (profit and loss) is how much money you've 'made or lost on paper' right now, before you actually sell. It's like checking the price of your house — you haven't made money until you sell.",
    detail:
      "Unrealized P&L = Current Market Value − Cost Basis. It is also called mark-to-market P&L. It fluctuates every time market prices move and only locks in (becomes realised) when you close the position.",
  },
  'realized-pnl': {
    term: 'Realized P&L',
    category: 'portfolio',
    simple:
      "Realized P&L is the actual profit or loss you've locked in after selling. Once you sell a position, the gain or loss is 'realized' — it's real money, and it may be taxable.",
    detail:
      "Realised P&L = Sale Proceeds − Cost Basis. For options, it includes premium collected minus premium paid back, plus any gains or losses on assigned shares. Realised gains are reported on your tax return as short-term (held < 1 year) or long-term capital gains.",
  },
  'cash-flows': {
    term: 'Cash Flows',
    category: 'portfolio',
    simple:
      "Cash flows are all the money moving in or out of your account — deposits, withdrawals, dividends, and transfers. Tracking cash flows separately from investment returns lets you see how much of your NAV came from gains vs. new money you added.",
    detail:
      "In portfolio analytics, separating cash flows from investment gains is essential for calculating true returns (like money-weighted or time-weighted return). If you deposit $5,000 and your NAV grows by $5,000, none of that growth is investment performance — it's just new money in.",
  },
  'ach-transfers': {
    term: 'ACH Transfers',
    category: 'portfolio',
    simple:
      "ACH transfers are bank-to-brokerage money moves (deposits and withdrawals) done through the Automated Clearing House network. They usually take 1–3 business days to settle. This is most of the money that flows into and out of your brokerage account.",
    detail:
      "ACH (Automated Clearing House) is the standard US electronic funds transfer network. Deposits via ACH are often available for trading immediately (with restrictions) but don't fully settle for 2–3 days. Tracking net ACH transfers helps separate invested capital from trading gains in NAV calculations.",
  },
  'market-value': {
    term: 'Market Value',
    category: 'portfolio',
    simple:
      "Market value is how much your holdings are worth right now at current market prices. It changes every second the market is open — it's the real-time worth of your portfolio.",
    detail:
      "For stocks, market value = shares owned × current price. For options, it is the mid-price of the bid-ask spread × 100 (per contract). Total portfolio market value sums all positions. It differs from NAV by the cash component.",
  },
  'cash-balance': {
    term: 'Cash Balance',
    category: 'portfolio',
    simple:
      "Cash balance is the amount of uninvested cash sitting in your brokerage account right now — money that isn't in any stock or option position.",
    detail:
      "Cash balance includes settled proceeds from sales, dividends received, and any deposits minus withdrawals. In margin accounts it can be negative if you've borrowed (margin debit). It is added to total position market value to compute NAV.",
  },

  // ── Strategy ──────────────────────────────────────────────────────────────
  wheel: {
    term: 'Wheel Strategy',
    category: 'strategy',
    simple:
      "The wheel is a cyclic options income strategy: sell a cash-secured put, get assigned into shares if the stock falls, then sell covered calls on those shares until they get called away, then repeat. You collect premium at every step.",
    detail:
      "Step 1: Sell a cash-secured put (CSP) on a stock you'd be happy owning. Collect premium. Step 2: If assigned, now own shares at the strike. Step 3: Sell covered calls (CC) against those shares to collect more premium. Step 4: If shares get called away, return to step 1. Best in range-bound to moderately bullish markets with elevated IV.",
  },
  csp: {
    term: 'Cash-Secured Put (CSP)',
    category: 'strategy',
    simple:
      "A cash-secured put means you sell someone the right to sell you their stock at the strike price, and you keep enough cash on hand to buy it if you have to. You collect the premium upfront and might end up buying the stock at a discount.",
    detail:
      "You sell one put contract and hold cash equal to (strike × 100) as collateral. Max gain = premium collected if the stock stays above strike at expiry. Max loss = strike − premium (stock falls to zero). This strategy is ideal when IV is high (option premium is rich) and you want to own the stock at a lower price.",
    example: 'Sell $45 put on stock trading at $48, collect $1.50 premium ($150). If stock stays above $45, keep $150.',
  },
  cc: {
    term: 'Covered Call (CC)',
    category: 'strategy',
    simple:
      "A covered call is when you own shares and sell someone the right to buy them from you at the strike price. You get paid premium immediately. The trade-off: if the stock rockets past the strike, you miss out on those extra gains.",
    detail:
      "Sell one call per 100 shares owned, with a strike above current price. Max gain = (strike − purchase price) + premium. Max loss = purchase price − premium (stock falls to zero). The call is 'covered' by the shares, so no additional margin is needed. Best when neutral to slightly bullish on the underlying.",
  },
  confluence: {
    term: 'Confluence',
    category: 'strategy',
    simple:
      "Confluence means multiple independent signals are all pointing in the same direction at the same time. It's like three weather apps all calling for rain — you're more confident bringing an umbrella.",
    detail:
      "A confluence score aggregates signals from different analytical lenses (technical, fundamental, volatility, sentiment) into a single 0–1 number. High confluence (close to 1) means most signals agree. Trades taken on high-confluence setups tend to have higher win rates and better risk/reward.",
    example: 'IV > HV, bullish regime, positive sentiment, and earnings beat → confluence score = 0.87.',
  },
  sentiment: {
    term: 'Sentiment',
    category: 'strategy',
    simple:
      "Sentiment is the overall mood of investors and the news toward a stock — are people bullish (hopeful), bearish (worried), or neutral? It's captured by scanning news articles, social media, and analyst ratings for positive or negative language.",
    detail:
      "NLP-based sentiment analysis scores each article or post on a scale (e.g., −1 very negative to +1 very positive) and aggregates across sources. Extreme positive sentiment can signal a crowded trade (risk of reversal); extreme negative can signal a contrarian opportunity. Sentiment is one input in a broader confluence score.",
  },
  mispricing: {
    term: 'Mispricing / IV Edge',
    category: 'strategy',
    simple:
      "Mispricing here means options are priced at a volatility level (IV) that seems too high or too low compared to the stock's actual recent moves (HV). A 'mispriced' option is an opportunity — sell it if overpriced, buy it if underpriced.",
    detail:
      "IV/HV > 1.2 suggests options are overpriced relative to realised volatility — a vol-selling edge. IV/HV < 0.85 suggests options are underpriced — a vol-buying edge. True edge requires accounting for regime, upcoming catalysts, and liquidity. The signal is strongest when multiple consecutive periods show the same bias.",
  },
  'black-scholes': {
    term: 'Black-Scholes Model',
    category: 'strategy',
    simple:
      "Black-Scholes is the most famous formula for pricing options. You feed it five inputs (stock price, strike, time, interest rate, volatility) and it spits out a fair price. It's the engine under most options pricing tools.",
    detail:
      "The Black-Scholes-Merton model assumes continuous log-normal price moves, no dividends, constant volatility, and frictionless markets — all approximations. Despite its limitations it remains the industry standard for quoting options via implied volatility. The model also produces the Greeks analytically.",
    formula: 'C = S·N(d₁) − K·e^{−rT}·N(d₂)  where d₁ = [ln(S/K)+(r+σ²/2)T]/(σ√T)',
  },

  // ── Metrics ───────────────────────────────────────────────────────────────
  'total-return': {
    term: 'Total Return',
    category: 'metrics',
    simple:
      "Total return is the overall gain or loss on your portfolio from start to finish, expressed as a percentage. It includes both price appreciation and any income (dividends, premium collected).",
    detail:
      "Total return = (Ending Value − Starting Value + Income) / Starting Value × 100%. For options strategies, income includes all premium received. It is distinct from risk-adjusted return (Sharpe) — a strategy can have a high total return while taking enormous risk to get there.",
    formula: 'Total Return = (NAV_end − NAV_start + Cash income) / NAV_start',
  },
  'monthly-returns': {
    term: 'Monthly Returns',
    category: 'metrics',
    simple:
      "Monthly returns show you how much the portfolio gained or lost each individual month. Looking at them together lets you spot seasonal patterns, streaks of losses, and how consistent the strategy really is.",
    detail:
      "Monthly returns are the building blocks of performance analysis. A strategy with a high total return but very volatile monthly returns (e.g., +30%, −25%, +18%, −20%) is harder to stick with than a steadier one. They feed into Sharpe (via standard deviation) and Calmar (via drawdown analysis).",
  },
  'equity-curve': {
    term: 'Equity Curve',
    category: 'metrics',
    simple:
      "An equity curve is a line chart of your portfolio's total value over time. A smooth, upward-sloping curve means consistent growth. Big dips and choppy lines indicate volatile or struggling performance.",
    detail:
      "The equity curve is the visual representation of cumulative returns. Drawdowns appear as dips from local peaks. Sophisticated traders look at the shape — not just the endpoint — because a smooth curve is much easier to follow psychologically and typically has a better Sharpe and Calmar than a lumpy one.",
  },
};
