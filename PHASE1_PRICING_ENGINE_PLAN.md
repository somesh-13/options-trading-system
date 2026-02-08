# Phase 1: Options Pricing Engine - Implementation Plan

## 🎯 Goal
Build a production-grade Black-Scholes options pricing engine with real-time Greeks calculation, using Next.js frontend + Python FastAPI backend.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         NEXT.JS FRONTEND                         │
├─────────────────────────────────────────────────────────────────┤
│  • Pricing Calculator UI                                        │
│  • Greeks Dashboard (Delta, Gamma, Vega, Theta)                 │
│  • Volatility Surface 3D Plot                                   │
│  • Option Chain Explorer                                        │
│  • Portfolio Greeks Aggregation                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↕ REST API
┌─────────────────────────────────────────────────────────────────┐
│                      PYTHON FASTAPI BACKEND                      │
├─────────────────────────────────────────────────────────────────┤
│  Endpoints:                                                      │
│  • POST /api/pricing/calculate     → Price single option        │
│  • POST /api/pricing/greeks        → Calculate Greeks           │
│  • POST /api/pricing/implied-vol   → Solve for IV               │
│  • GET  /api/pricing/chain/:ticker → Fetch options chain        │
│  • POST /api/pricing/surface       → Generate vol surface       │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                      CORE PRICING LIBRARY                        │
├─────────────────────────────────────────────────────────────────┤
│  Modules:                                                        │
│  • black_scholes.py    → Call/Put pricing (vectorized)          │
│  • greeks.py           → All Greeks calculations                │
│  • implied_vol.py      → Newton-Raphson IV solver               │
│  • binomial_tree.py    → American options (future)              │
│  • monte_carlo.py      → Exotic options (future)                │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                             │
├─────────────────────────────────────────────────────────────────┤
│  • Alpaca API          → Real-time options chain data           │
│  • Yahoo Finance       → Historical price data                  │
│  • FRED                → Risk-free rate (10Y Treasury)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 Tech Stack

### Backend (Python)
- **Framework:** FastAPI (async, auto-docs, fast)
- **Numeric Computing:** NumPy, SciPy
- **Data Processing:** Pandas
- **API Client:** `alpaca-trade-api`, `yfinance`
- **Testing:** pytest, pytest-cov
- **Type Checking:** mypy
- **Linting:** black, flake8

### Frontend (Next.js)
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Charts:** Recharts (2D), Plotly.js (3D volatility surface)
- **Forms:** React Hook Form + Zod validation
- **State:** React Query (API caching)

### DevOps
- **Backend Server:** Uvicorn (ASGI)
- **Process Manager:** PM2 or systemd
- **Reverse Proxy:** Nginx (optional)
- **Monitoring:** Prometheus + Grafana (future)

---

## 📂 Project Structure

```
trading-dashboard-app/
├── backend/                          # Python FastAPI server
│   ├── src/
│   │   ├── pricing/
│   │   │   ├── __init__.py
│   │   │   ├── black_scholes.py      # Core pricing formulas
│   │   │   ├── greeks.py             # Greeks calculations
│   │   │   ├── implied_vol.py        # IV solver
│   │   │   └── utils.py              # Helper functions
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── routes.py             # FastAPI endpoints
│   │   │   ├── models.py             # Pydantic models
│   │   │   └── dependencies.py       # Shared dependencies
│   │   ├── data/
│   │   │   ├── __init__.py
│   │   │   ├── alpaca_client.py      # Alpaca integration
│   │   │   └── market_data.py        # Market data fetchers
│   │   └── main.py                   # FastAPI app entry
│   ├── tests/
│   │   ├── test_black_scholes.py
│   │   ├── test_greeks.py
│   │   └── test_implied_vol.py
│   ├── requirements.txt
│   ├── pytest.ini
│   └── README.md
│
├── src/                              # Next.js frontend (existing)
│   ├── app/
│   │   ├── pricing/
│   │   │   └── page.tsx              # Pricing calculator page
│   │   ├── greeks/
│   │   │   └── page.tsx              # Greeks dashboard
│   │   └── volatility/
│   │       └── page.tsx              # Volatility surface
│   ├── components/
│   │   ├── PricingCalculator.tsx     # Input form for pricing
│   │   ├── GreeksTable.tsx           # Greeks display
│   │   ├── OptionChain.tsx           # Options chain table
│   │   ├── VolatilitySurface.tsx     # 3D plot
│   │   └── GreeksChart.tsx           # Greeks vs spot price
│   └── lib/
│       └── pricing-api.ts            # API client for Python backend
│
└── docker-compose.yml                # Local development setup
```

---

## 🔢 Mathematical Foundation

### Black-Scholes Formula

**Call Option:**
```
C = S * N(d1) - K * exp(-r*T) * N(d2)

where:
d1 = [ln(S/K) + (r + σ²/2)*T] / (σ*√T)
d2 = d1 - σ*√T
N(x) = Cumulative normal distribution
```

**Put Option:**
```
P = K * exp(-r*T) * N(-d2) - S * N(-d1)
```

### Greeks Formulas

**Delta (∂V/∂S):**
```
Δ_call = N(d1)
Δ_put = N(d1) - 1
```

**Gamma (∂²V/∂S²):**
```
Γ = φ(d1) / (S * σ * √T)
where φ(x) = (1/√2π) * exp(-x²/2)  [Normal PDF]
```

**Vega (∂V/∂σ):**
```
ν = S * √T * φ(d1)
```

**Theta (∂V/∂t):**
```
Θ_call = -[S*φ(d1)*σ/(2*√T)] - r*K*exp(-r*T)*N(d2)
Θ_put = -[S*φ(d1)*σ/(2*√T)] + r*K*exp(-r*T)*N(-d2)
```

**Rho (∂V/∂r):**
```
ρ_call = K * T * exp(-r*T) * N(d2)
ρ_put = -K * T * exp(-r*T) * N(-d2)
```

### Implied Volatility (Newton-Raphson)

```python
def implied_vol(market_price, S, K, T, r, option_type='call'):
    sigma = 0.3  # Initial guess
    for i in range(100):  # Max iterations
        price = black_scholes(S, K, T, r, sigma, option_type)
        vega = calculate_vega(S, K, T, r, sigma)
        
        diff = market_price - price
        if abs(diff) < 1e-6:  # Convergence threshold
            return sigma
        
        sigma += diff / vega  # Newton-Raphson update
    
    return None  # Did not converge
```

---

## 🛠️ Implementation Steps

### Step 1: Python Backend Core (Days 1-3)

#### 1.1 Setup FastAPI Project
```bash
cd trading-dashboard-app
mkdir -p backend/src/pricing backend/src/api backend/src/data backend/tests
cd backend
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn numpy scipy pandas alpaca-trade-api yfinance pydantic pytest
pip freeze > requirements.txt
```

#### 1.2 Implement Black-Scholes (`backend/src/pricing/black_scholes.py`)

```python
import numpy as np
from scipy.stats import norm

def black_scholes_call(S, K, T, r, sigma):
    """
    Calculate European call option price using Black-Scholes.
    
    Args:
        S: Spot price (float or np.array)
        K: Strike price (float or np.array)
        T: Time to expiration in years (float or np.array)
        r: Risk-free rate (float)
        sigma: Volatility (float or np.array)
    
    Returns:
        Call option price (float or np.array)
    """
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    call_price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    return call_price

def black_scholes_put(S, K, T, r, sigma):
    """Calculate European put option price using Black-Scholes."""
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    put_price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    return put_price

def black_scholes(S, K, T, r, sigma, option_type='call'):
    """Unified interface for call/put pricing."""
    if option_type.lower() == 'call':
        return black_scholes_call(S, K, T, r, sigma)
    elif option_type.lower() == 'put':
        return black_scholes_put(S, K, T, r, sigma)
    else:
        raise ValueError("option_type must be 'call' or 'put'")
```

**Test File (`backend/tests/test_black_scholes.py`):**

```python
import pytest
import numpy as np
from src.pricing.black_scholes import black_scholes

def test_call_option_pricing():
    """Test call option pricing with known values."""
    # Known test case: S=100, K=100, T=1, r=0.05, sigma=0.2
    # Expected call price ≈ 10.45
    price = black_scholes(100, 100, 1, 0.05, 0.2, 'call')
    assert abs(price - 10.45) < 0.01

def test_put_call_parity():
    """Verify put-call parity: C - P = S - K*exp(-r*T)."""
    S, K, T, r, sigma = 100, 100, 1, 0.05, 0.2
    call = black_scholes(S, K, T, r, sigma, 'call')
    put = black_scholes(S, K, T, r, sigma, 'put')
    
    lhs = call - put
    rhs = S - K * np.exp(-r * T)
    
    assert abs(lhs - rhs) < 1e-6

def test_vectorized_pricing():
    """Test vectorized input (multiple strikes)."""
    S = 100
    K = np.array([90, 95, 100, 105, 110])
    T, r, sigma = 1, 0.05, 0.2
    
    prices = black_scholes(S, K, T, r, sigma, 'call')
    
    assert len(prices) == 5
    assert all(prices > 0)  # All positive prices
    assert all(np.diff(prices) < 0)  # Decreasing as K increases
```

#### 1.3 Implement Greeks (`backend/src/pricing/greeks.py`)

```python
import numpy as np
from scipy.stats import norm

def calculate_greeks(S, K, T, r, sigma, option_type='call'):
    """
    Calculate all Greeks for an option.
    
    Returns:
        dict: {delta, gamma, vega, theta, rho}
    """
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    # Common terms
    phi_d1 = norm.pdf(d1)  # Normal PDF at d1
    N_d1 = norm.cdf(d1)
    N_d2 = norm.cdf(d2)
    N_minus_d1 = norm.cdf(-d1)
    N_minus_d2 = norm.cdf(-d2)
    
    # Delta
    if option_type == 'call':
        delta = N_d1
    else:
        delta = N_d1 - 1
    
    # Gamma (same for call and put)
    gamma = phi_d1 / (S * sigma * np.sqrt(T))
    
    # Vega (same for call and put)
    vega = S * np.sqrt(T) * phi_d1 / 100  # Divide by 100 for 1% vol change
    
    # Theta
    if option_type == 'call':
        theta = (
            -(S * phi_d1 * sigma) / (2 * np.sqrt(T))
            - r * K * np.exp(-r * T) * N_d2
        ) / 365  # Divide by 365 for per-day theta
    else:
        theta = (
            -(S * phi_d1 * sigma) / (2 * np.sqrt(T))
            + r * K * np.exp(-r * T) * N_minus_d2
        ) / 365
    
    # Rho
    if option_type == 'call':
        rho = K * T * np.exp(-r * T) * N_d2 / 100  # Divide by 100 for 1% rate change
    else:
        rho = -K * T * np.exp(-r * T) * N_minus_d2 / 100
    
    return {
        'delta': float(delta),
        'gamma': float(gamma),
        'vega': float(vega),
        'theta': float(theta),
        'rho': float(rho)
    }
```

#### 1.4 Implement Implied Volatility Solver (`backend/src/pricing/implied_vol.py`)

```python
import numpy as np
from .black_scholes import black_scholes
from .greeks import calculate_greeks

def implied_volatility(market_price, S, K, T, r, option_type='call', max_iterations=100, tolerance=1e-6):
    """
    Solve for implied volatility using Newton-Raphson method.
    
    Args:
        market_price: Observed option price
        S, K, T, r: Black-Scholes parameters
        option_type: 'call' or 'put'
        max_iterations: Maximum solver iterations
        tolerance: Convergence threshold
    
    Returns:
        Implied volatility (float) or None if no convergence
    """
    sigma = 0.3  # Initial guess (30% volatility)
    
    for i in range(max_iterations):
        # Calculate theoretical price and vega
        price = black_scholes(S, K, T, r, sigma, option_type)
        greeks = calculate_greeks(S, K, T, r, sigma, option_type)
        vega = greeks['vega'] * 100  # Undo the /100 scaling
        
        # Check convergence
        diff = market_price - price
        if abs(diff) < tolerance:
            return sigma
        
        # Newton-Raphson update
        if vega == 0:
            return None  # Avoid division by zero
        
        sigma += diff / vega
        
        # Keep sigma within reasonable bounds
        sigma = max(0.01, min(sigma, 5.0))
    
    return None  # Did not converge
```

#### 1.5 Create FastAPI Endpoints (`backend/src/api/routes.py`)

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
import sys
sys.path.append('..')

from src.pricing.black_scholes import black_scholes
from src.pricing.greeks import calculate_greeks
from src.pricing.implied_vol import implied_volatility

app = FastAPI(
    title="Options Pricing API",
    description="Black-Scholes pricing engine with Greeks calculation",
    version="1.0.0"
)

# Pydantic models for request validation
class OptionParams(BaseModel):
    S: float = Field(..., gt=0, description="Spot price")
    K: float = Field(..., gt=0, description="Strike price")
    T: float = Field(..., gt=0, le=10, description="Time to expiration (years)")
    r: float = Field(..., ge=0, le=1, description="Risk-free rate")
    sigma: float = Field(..., gt=0, le=5, description="Volatility")
    option_type: Literal['call', 'put'] = Field(..., description="Option type")

class ImpliedVolParams(BaseModel):
    market_price: float = Field(..., gt=0, description="Observed market price")
    S: float = Field(..., gt=0, description="Spot price")
    K: float = Field(..., gt=0, description="Strike price")
    T: float = Field(..., gt=0, le=10, description="Time to expiration (years)")
    r: float = Field(..., ge=0, le=1, description="Risk-free rate")
    option_type: Literal['call', 'put'] = Field(..., description="Option type")

# Endpoints
@app.get("/")
def root():
    return {"message": "Options Pricing API - Use /docs for API documentation"}

@app.post("/api/pricing/calculate")
def calculate_price(params: OptionParams):
    """Calculate option price using Black-Scholes."""
    try:
        price = black_scholes(
            params.S, params.K, params.T, params.r, params.sigma, params.option_type
        )
        return {
            "price": float(price),
            "parameters": params.dict()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pricing/greeks")
def calculate_option_greeks(params: OptionParams):
    """Calculate all Greeks for an option."""
    try:
        price = black_scholes(
            params.S, params.K, params.T, params.r, params.sigma, params.option_type
        )
        greeks = calculate_greeks(
            params.S, params.K, params.T, params.r, params.sigma, params.option_type
        )
        
        return {
            "price": float(price),
            "greeks": greeks,
            "parameters": params.dict()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pricing/implied-vol")
def solve_implied_vol(params: ImpliedVolParams):
    """Solve for implied volatility from market price."""
    try:
        iv = implied_volatility(
            params.market_price, params.S, params.K, params.T, params.r, params.option_type
        )
        
        if iv is None:
            raise HTTPException(status_code=400, detail="IV solver did not converge")
        
        return {
            "implied_volatility": float(iv),
            "market_price": params.market_price,
            "parameters": params.dict()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "healthy"}
```

#### 1.6 Run Backend Server

```bash
# From backend/ directory
uvicorn src.api.routes:app --reload --port 8000
```

Test at: http://localhost:8000/docs (FastAPI auto-generated docs)

---

### Step 2: Next.js Frontend Integration (Days 4-5)

#### 2.1 Create API Client (`src/lib/pricing-api.ts`)

```typescript
const PRICING_API_URL = process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000';

export interface OptionParams {
  S: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
  option_type: 'call' | 'put';
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

export interface PricingResponse {
  price: number;
  greeks: Greeks;
  parameters: OptionParams;
}

export async function calculatePriceAndGreeks(params: OptionParams): Promise<PricingResponse> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/greeks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Pricing API error: ${response.statusText}`);
  }

  return response.json();
}

export async function calculateImpliedVol(
  market_price: number,
  S: number,
  K: number,
  T: number,
  r: number,
  option_type: 'call' | 'put'
): Promise<number> {
  const response = await fetch(`${PRICING_API_URL}/api/pricing/implied-vol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market_price, S, K, T, r, option_type }),
  });

  if (!response.ok) {
    throw new Error(`IV solver error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.implied_volatility;
}
```

#### 2.2 Create Pricing Calculator Component (`src/components/PricingCalculator.tsx`)

```typescript
'use client';

import { useState } from 'react';
import { calculatePriceAndGreeks, type OptionParams, type PricingResponse } from '@/lib/pricing-api';

export default function PricingCalculator() {
  const [params, setParams] = useState<OptionParams>({
    S: 100,
    K: 100,
    T: 1,
    r: 0.05,
    sigma: 0.2,
    option_type: 'call',
  });

  const [result, setResult] = useState<PricingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await calculatePriceAndGreeks(params);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#2D2D2D] rounded-lg p-6">
      <h2 className="text-2xl font-bold mb-6">Black-Scholes Pricing Calculator</h2>
      
      {/* Input Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Spot Price (S)</label>
          <input
            type="number"
            value={params.S}
            onChange={(e) => setParams({ ...params, S: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Strike Price (K)</label>
          <input
            type="number"
            value={params.K}
            onChange={(e) => setParams({ ...params, K: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Time to Expiration (years)</label>
          <input
            type="number"
            step="0.01"
            value={params.T}
            onChange={(e) => setParams({ ...params, T: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Risk-Free Rate (r)</label>
          <input
            type="number"
            step="0.001"
            value={params.r}
            onChange={(e) => setParams({ ...params, r: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Volatility (σ)</label>
          <input
            type="number"
            step="0.01"
            value={params.sigma}
            onChange={(e) => setParams({ ...params, sigma: parseFloat(e.target.value) })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg"
          />
        </div>
        
        <div>
          <label className="block text-sm text-gray-400 mb-2">Option Type</label>
          <select
            value={params.option_type}
            onChange={(e) => setParams({ ...params, option_type: e.target.value as 'call' | 'put' })}
            className="w-full bg-[#1E1E1E] text-white px-4 py-2 rounded-lg"
          >
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleCalculate}
        disabled={loading}
        className="w-full bg-[#00C805] hover:bg-[#00A004] text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading ? 'Calculating...' : 'Calculate Price & Greeks'}
      </button>

      {error && (
        <div className="mt-4 bg-[#FF006E] bg-opacity-20 border border-[#FF006E] text-[#FF006E] px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {/* Option Price */}
          <div className="bg-[#1E1E1E] rounded-lg p-6">
            <p className="text-sm text-gray-400 mb-2">Option Price</p>
            <p className="text-4xl font-bold text-[#00C805]">
              ${result.price.toFixed(4)}
            </p>
          </div>

          {/* Greeks */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Delta (Δ)</p>
              <p className="text-xl font-bold">{result.greeks.delta.toFixed(4)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Gamma (Γ)</p>
              <p className="text-xl font-bold">{result.greeks.gamma.toFixed(4)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Vega (ν)</p>
              <p className="text-xl font-bold">{result.greeks.vega.toFixed(4)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Theta (Θ)</p>
              <p className="text-xl font-bold">{result.greeks.theta.toFixed(4)}</p>
            </div>
            <div className="bg-[#1E1E1E] rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Rho (ρ)</p>
              <p className="text-xl font-bold">{result.greeks.rho.toFixed(4)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

#### 2.3 Create Pricing Page (`src/app/pricing/page.tsx`)

```typescript
import PricingCalculator from '@/components/PricingCalculator';

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Options Pricing Engine</h1>
          <p className="text-gray-400">Black-Scholes Model with Real-Time Greeks</p>
        </header>

        <PricingCalculator />

        {/* Theory Section */}
        <div className="mt-12 bg-[#2D2D2D] rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Black-Scholes Model</h3>
          <p className="text-gray-300 mb-4">
            The Black-Scholes model prices European options by assuming log-normal stock price 
            distribution, constant volatility, and no transaction costs. The model outputs the 
            theoretical fair value and sensitivity measures (Greeks) for risk management.
          </p>
          
          <h4 className="font-bold mb-2">Greeks Interpretation:</h4>
          <ul className="space-y-2 text-gray-300">
            <li><strong>Delta (Δ):</strong> Change in option price per $1 change in stock price</li>
            <li><strong>Gamma (Γ):</strong> Rate of change of delta (curvature of price curve)</li>
            <li><strong>Vega (ν):</strong> Change in option price per 1% change in volatility</li>
            <li><strong>Theta (Θ):</strong> Time decay - change in price per day</li>
            <li><strong>Rho (ρ):</strong> Change in option price per 1% change in interest rate</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
```

---

### Step 3: Testing & Validation (Day 6)

#### 3.1 Backend Tests
```bash
cd backend
pytest tests/ -v --cov=src
```

**Expected Coverage:** >90% for core pricing modules

#### 3.2 Manual Validation
Test against known Black-Scholes calculators:
- [Option Price Calculator](https://www.option-price.com/calculator.php)
- Compare with Bloomberg/Reuters data (if available)

#### 3.3 Edge Cases to Test
- Very short expiration (T < 0.01)
- Deep ITM/OTM options (S/K ratios: 0.5, 1.5, 2.0)
- High volatility (σ > 1.0)
- IV solver with extreme market prices

---

### Step 4: Deployment (Day 7)

#### 4.1 Production Setup

**Backend (Python FastAPI):**
```bash
# Create systemd service (Ubuntu)
sudo nano /etc/systemd/system/pricing-api.service
```

```ini
[Unit]
Description=Options Pricing API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/.openclaw/workspace/trading-dashboard-app/backend
Environment="PATH=/home/ubuntu/.openclaw/workspace/trading-dashboard-app/backend/venv/bin"
ExecStart=/home/ubuntu/.openclaw/workspace/trading-dashboard-app/backend/venv/bin/uvicorn src.api.routes:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable pricing-api
sudo systemctl start pricing-api
sudo systemctl status pricing-api
```

**Frontend (Next.js):**
```bash
# Update .env.local
NEXT_PUBLIC_PRICING_API_URL=http://localhost:8000

# Build and run
npm run build
npm start  # Production mode on port 3000
```

#### 4.2 Nginx Reverse Proxy (Optional)
```nginx
# /etc/nginx/sites-available/trading-dashboard

server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API
    location /api/pricing/ {
        proxy_pass http://localhost:8000/api/pricing/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 📊 Success Metrics

### Performance
- **Latency:** Pricing calculation < 10ms (vectorized NumPy)
- **Throughput:** 1000+ requests/second (FastAPI async)
- **Accuracy:** Pricing error < $0.01 vs known values

### Code Quality
- **Test Coverage:** >90% (pytest-cov)
- **Type Safety:** mypy --strict passes with 0 errors
- **Documentation:** Docstrings for all public functions

### User Experience
- **Response Time:** Frontend calculation < 500ms total (including network)
- **Error Handling:** Clear error messages for invalid inputs
- **Accessibility:** WCAG 2.1 Level AA compliance

---

## 🎯 Deliverables

1. **Python Library:** `backend/src/pricing/` with Black-Scholes, Greeks, IV solver
2. **FastAPI Service:** RESTful API with auto-generated docs
3. **Next.js Frontend:** Interactive pricing calculator
4. **Test Suite:** >90% coverage with edge case validation
5. **Documentation:** README with theoretical foundation + API reference

---

## 🚀 Next Steps After Phase 1

Once the pricing engine is complete:
1. **Phase 2:** Volatility analysis (IV vs HV comparison)
2. **Phase 3:** NLP pipeline for alternative data
3. **Phase 4:** Backtesting framework

---

## ⏱️ Timeline

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Backend setup + Black-Scholes | Working price calculation |
| 2 | Greeks implementation | All 5 Greeks calculated |
| 3 | IV solver + FastAPI routes | API with /docs |
| 4 | Frontend API client | pricing-api.ts working |
| 5 | Pricing calculator UI | Interactive calculator page |
| 6 | Testing + validation | >90% test coverage |
| 7 | Deployment | Production-ready system |

**Total: 7 days** → Ready for Phase 2

---

Ready to start building? I'll create the backend structure and implement Black-Scholes first.
