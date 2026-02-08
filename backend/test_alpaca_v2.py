"""Test Alpaca API with alpaca-py library"""
import os
from dotenv import load_dotenv
from alpaca.trading.client import TradingClient
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestTradeRequest

# Load environment variables
load_dotenv('.env')

api_key = os.getenv('ALPACA_API_KEY')
secret_key = os.getenv('ALPACA_SECRET_KEY')

print("Testing Alpaca API Connection (alpaca-py)...")
print(f"API Key: {api_key[:10]}...")

try:
    # Initialize Trading Client (for account info)
    trading_client = TradingClient(api_key, secret_key, paper=True)
    
    # Test: Get account info
    account = trading_client.get_account()
    
    print("\n✅ Trading API connected!")
    print(f"Account Status: {account.status}")
    print(f"Portfolio Value: ${float(account.portfolio_value):,.2f}")
    print(f"Cash: ${float(account.cash):,.2f}")
    print(f"Buying Power: ${float(account.buying_power):,.2f}")
    
    # Initialize Data Client (for market data)
    data_client = StockHistoricalDataClient(api_key, secret_key)
    
    # Test: Get CIFR latest trade
    request = StockLatestTradeRequest(symbol_or_symbols=["CIFR"])
    latest_trade = data_client.get_stock_latest_trade(request)
    
    print(f"\n✅ Market Data API connected!")
    print(f"CIFR Latest Trade: ${latest_trade['CIFR'].price}")
    
except Exception as e:
    print(f"\n❌ Connection failed: {e}")
    import traceback
    traceback.print_exc()
