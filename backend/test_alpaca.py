"""Quick test to verify Alpaca API credentials"""
import os
from dotenv import load_dotenv
import alpaca_trade_api as tradeapi

# Load environment variables
load_dotenv('.env')

api_key = os.getenv('ALPACA_API_KEY')
secret_key = os.getenv('ALPACA_SECRET_KEY')
base_url = os.getenv('ALPACA_BASE_URL')

print("Testing Alpaca API Connection...")
print(f"API Key: {api_key[:10]}...")
print(f"Base URL: {base_url}")

try:
    # Initialize Alpaca API
    api = tradeapi.REST(
        key_id=api_key,
        secret_key=secret_key,
        base_url=base_url
    )
    
    # Test: Get account info
    account = api.get_account()
    
    print("\n✅ Connection successful!")
    print(f"Account Status: {account.status}")
    print(f"Portfolio Value: ${float(account.portfolio_value):,.2f}")
    print(f"Cash: ${float(account.cash):,.2f}")
    print(f"Buying Power: ${float(account.buying_power):,.2f}")
    
    # Test: Get CIFR current price
    cifr_quote = api.get_latest_trade('CIFR')
    print(f"\nCIFR Current Price: ${cifr_quote.price}")
    
except Exception as e:
    print(f"\n❌ Connection failed: {e}")
