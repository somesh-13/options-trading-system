#!/usr/bin/env python3
"""
Keltner Channel + VegaEdge Signal Detection
Combines technical analysis with IV/HV ratios for high-probability setups
"""

import requests
import os
from datetime import datetime, timedelta


def should_sell_put(keltner_position, iv_hv_ratio, iv_percentile):
    """
    Determine if we should SELL cash-secured puts
    
    Criteria:
    - Price at BOTTOM of Keltner Channel (support)
    - IV spike detected (IV/HV > 1.3 OR IV > 80th percentile)
    
    Args:
        keltner_position: 'BOTTOM'|'TOP'|'MIDDLE'
        iv_hv_ratio: Current IV/HV ratio
        iv_percentile: IV percentile (0-100)
    
    Returns:
        (bool, str): (should_sell, reason)
    """
    if keltner_position != 'BOTTOM':
        return False, "Not at channel bottom"
    
    # Check for IV spike
    has_iv_spike = (iv_hv_ratio > 1.3) or (iv_percentile > 80)
    
    if not has_iv_spike:
        return False, f"No IV spike (IV/HV={iv_hv_ratio:.2f}, IV%={iv_percentile})"
    
    reason = f"Bottom support + IV spike (IV/HV={iv_hv_ratio:.2f})"
    return True, reason


def should_sell_call(keltner_position, iv_hv_ratio, iv_percentile, has_shares=False):
    """
    Determine if we should SELL covered calls
    
    Criteria:
    - Price at TOP of Keltner Channel (resistance)
    - IV spike detected (IV/HV > 1.3 OR IV > 80th percentile)
    - Must own shares (covered call requirement)
    
    Args:
        keltner_position: 'BOTTOM'|'TOP'|'MIDDLE'
        iv_hv_ratio: Current IV/HV ratio
        iv_percentile: IV percentile (0-100)
        has_shares: Whether user owns shares (default False)
    
    Returns:
        (bool, str): (should_sell, reason)
    """
    if keltner_position != 'TOP':
        return False, "Not at channel top"
    
    if not has_shares:
        return False, "No shares to cover the call (requires ownership)"
    
    # Check for IV spike
    has_iv_spike = (iv_hv_ratio > 1.3) or (iv_percentile > 80)
    
    if not has_iv_spike:
        return False, f"No IV spike (IV/HV={iv_hv_ratio:.2f}, IV%={iv_percentile})"
    
    reason = f"Top resistance + IV spike (IV/HV={iv_hv_ratio:.2f})"
    return True, reason


def should_buy_leaps(iv_hv_ratio, iv_percentile, keltner_position=None):
    """
    Determine if we should BUY long-dated calls (LEAPs)
    
    Criteria:
    - IV extremely cheap (IV/HV < 0.8)
    - IV in bottom 20% historically (IV percentile < 20)
    - Bonus: Price at Keltner bottom (technical support)
    
    Args:
        iv_hv_ratio: Current IV/HV ratio
        iv_percentile: IV percentile (0-100)
        keltner_position: 'BOTTOM'|'TOP'|'MIDDLE' (optional)
    
    Returns:
        (bool, str, float): (should_buy, reason, discount_pct)
    """
    if iv_hv_ratio >= 0.8:
        return False, f"IV not cheap enough (IV/HV={iv_hv_ratio:.2f}, need <0.8)", None
    
    if iv_percentile >= 20:
        return False, f"IV not in bottom 20% ({iv_percentile}th percentile)", None
    
    # Determine discount for limit orders based on how cheap IV is
    if iv_hv_ratio < 0.6:
        discount = 0.20  # 20% below ask if IV super cheap
    elif iv_hv_ratio < 0.7:
        discount = 0.15  # 15% below ask
    else:
        discount = 0.10  # 10% below ask (0.7-0.8 range)
    
    reason = f"IV extremely cheap (IV/HV={iv_hv_ratio:.2f}, {iv_percentile}th percentile)"
    
    # Extra discount if at Keltner bottom (double confirmation)
    if keltner_position == 'BOTTOM':
        reason += " + Price at channel support"
        discount += 0.05  # Extra 5% discount
    
    return True, reason, discount


def get_leap_pricing(symbol, current_price, years_out=[1.5, 2.0]):
    """
    Get LEAP call pricing for ATM strikes
    
    Args:
        symbol: Stock ticker
        current_price: Current stock price
        years_out: List of years (1.5 = Jan next year, 2.0 = Jan year after)
    
    Returns:
        list of dict with LEAP options data
    """
    # Calculate target expiration dates
    now = datetime.now()
    leap_options = []
    
    for years in years_out:
        # Target January expiration
        target_year = now.year + int(years)
        if years < 1.0 + (now.month / 12.0):
            target_year += 1
        
        exp_date = datetime(target_year, 1, 15)  # 3rd Friday usually ~15th
        
        # Round current price to nearest $5 for ATM strike
        atm_strike = round(current_price / 5) * 5
        
        leap_options.append({
            'expiration': exp_date.strftime('%Y-%m-%d'),
            'strike': atm_strike,
            'years_out': years,
            'description': f'Jan {target_year} ${atm_strike} Call'
        })
    
    return leap_options


def format_signal_alert(signal_type, symbol, keltner, iv_data, leap_data=None, discount=None):
    """
    Format alert message for WhatsApp
    
    Args:
        signal_type: 'SELL_PUT' | 'SELL_CALL' | 'BUY_LEAP'
        symbol: Stock ticker
        keltner: Keltner channel data dict
        iv_data: IV/HV data dict with keys: iv_hv_ratio, iv_percentile, hv_percentile
        leap_data: LEAP options data (for BUY_LEAP signal)
        discount: Discount percentage for limit orders (for BUY_LEAP)
    
    Returns:
        str: Formatted alert message
    """
    msg = []
    msg.append(f"📊 {symbol} - ${keltner['current_price']:.2f}")
    msg.append(f"Keltner Position: {keltner['position']} {'🟢' if keltner['position'] == 'BOTTOM' else '🔴' if keltner['position'] == 'TOP' else '⚪'}")
    msg.append(f"Lower: ${keltner['lower']:.2f} | Middle: ${keltner['middle']:.2f} | Upper: ${keltner['upper']:.2f}")
    msg.append(f"")
    
    if signal_type == 'SELL_PUT':
        msg.append(f"🎯 SIGNAL: SELL CASH-SECURED PUT")
        msg.append(f"• Price at channel support ({keltner['pct_from_lower']:.1f}% from lower band)")
        msg.append(f"• IV spike: IV/HV={iv_data['iv_hv_ratio']:.2f}, IV {iv_data['iv_percentile']}th percentile")
        msg.append(f"• Premium opportunity: High IV + Technical support")
        msg.append(f"")
        
        # Suggest strikes (25-30% OTM)
        strike_25 = int(keltner['current_price'] * 0.75 / 5) * 5
        strike_20 = int(keltner['current_price'] * 0.80 / 5) * 5
        msg.append(f"Suggested strikes: ${strike_25}, ${strike_20} (weekly/monthly)")
        
    elif signal_type == 'SELL_CALL':
        msg.append(f"🎯 SIGNAL: SELL COVERED CALL")
        msg.append(f"• Price at channel resistance ({keltner['pct_from_upper']:.1f}% from upper band)")
        msg.append(f"• IV spike: IV/HV={iv_data['iv_hv_ratio']:.2f}, IV {iv_data['iv_percentile']}th percentile")
        msg.append(f"• Premium opportunity: High IV + Technical resistance")
        msg.append(f"")
        msg.append(f"⚠️ Requires: Must own {symbol} shares for covered call")
        
        # Suggest strikes (slightly OTM)
        strike_5 = int((keltner['current_price'] * 1.05) / 5) * 5
        strike_10 = int((keltner['current_price'] * 1.10) / 5) * 5
        msg.append(f"Suggested strikes: ${strike_5}, ${strike_10} (weekly/monthly)")
        
    elif signal_type == 'BUY_LEAP':
        msg.append(f"🎯 SIGNAL: BUY LEAP CALLS (1.5-2 years)")
        msg.append(f"• IV extremely cheap: IV/HV={iv_data['iv_hv_ratio']:.2f} ({iv_data['iv_percentile']}th percentile)")
        msg.append(f"• {keltner['position']} of channel" + (" (at support!)" if keltner['position'] == 'BOTTOM' else ""))
        msg.append(f"")
        
        if leap_data and discount:
            for leap in leap_data:
                msg.append(f"📋 {leap['description']}")
                msg.append(f"   Strike: ${leap['strike']} (ATM)")
                msg.append(f"   Limit order discount: {discount*100:.0f}%")
                msg.append(f"   (Place GTC limit order {discount*100:.0f}% below current ask)")
                msg.append(f"")
            
            msg.append(f"💡 Strategy: Patient capital, abnormally cheap entry")
            msg.append(f"⏰ Time: {leap_data[0]['years_out']:.1f}-{leap_data[-1]['years_out']:.1f} years for thesis")
    
    return "\n".join(msg)


if __name__ == '__main__':
    # Test signal logic
    print("\n🧪 Testing Signal Detection Logic")
    print("=" * 60)
    
    # Test 1: Sell Put (bottom + IV spike)
    print("\nTest 1: Sell Cash-Secured Put")
    should_sell, reason = should_sell_put('BOTTOM', 1.5, 85)
    print(f"  Result: {should_sell}")
    print(f"  Reason: {reason}")
    
    # Test 2: Sell Call (top + IV spike)
    print("\nTest 2: Sell Covered Call")
    should_sell, reason = should_sell_call('TOP', 1.6, 90, has_shares=True)
    print(f"  Result: {should_sell}")
    print(f"  Reason: {reason}")
    
    # Test 3: Buy LEAP (IV cheap)
    print("\nTest 3: Buy LEAP Calls")
    should_buy, reason, discount = should_buy_leaps(0.65, 12, 'BOTTOM')
    print(f"  Result: {should_buy}")
    print(f"  Reason: {reason}")
    print(f"  Discount: {discount*100:.0f}%" if discount else "  No discount")
    
    # Test 4: Format alert
    print("\nTest 4: Format LEAP Buy Alert")
    keltner_mock = {
        'symbol': 'HOOD',
        'current_price': 73.44,
        'lower': 65.00,
        'middle': 85.00,
        'upper': 105.00,
        'position': 'BOTTOM',
        'pct_from_lower': 15.0,
        'pct_from_upper': 85.0
    }
    iv_mock = {
        'iv_hv_ratio': 0.65,
        'iv_percentile': 12,
        'hv_percentile': 100
    }
    leap_mock = get_leap_pricing('HOOD', 73.44, [1.5, 2.0])
    
    alert = format_signal_alert('BUY_LEAP', 'HOOD', keltner_mock, iv_mock, leap_mock, 0.25)
    print("\n" + alert)
