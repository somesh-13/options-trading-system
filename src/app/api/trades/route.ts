import { NextResponse } from 'next/server';
import alpaca from '@/lib/alpaca';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    
    const orders = await alpaca.getOrders({
      status: 'all',
      limit,
      nested: true,
      until: undefined,
      after: undefined,
      direction: undefined,
      symbols: undefined,
    });
    
    return NextResponse.json({ success: true, data: orders });
  } catch (error: any) {
    console.error('Error fetching trades:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
