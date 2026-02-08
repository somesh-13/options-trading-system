import { NextResponse } from 'next/server';
import alpaca from '@/lib/alpaca';

export async function GET() {
  try {
    const account = await alpaca.getAccount();
    
    const portfolioValue = parseFloat(account.portfolio_value);
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);
    
    // Calculate P&L
    const dayPL = parseFloat(account.equity) - parseFloat(account.last_equity);
    const dayPLPercent = (dayPL / parseFloat(account.last_equity)) * 100;
    
    return NextResponse.json({
      success: true,
      data: {
        portfolioValue,
        equity,
        cash,
        buyingPower,
        dayPL,
        dayPLPercent,
      }
    });
  } catch (error: any) {
    console.error('Error fetching portfolio:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
