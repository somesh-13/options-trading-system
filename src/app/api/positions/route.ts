import { NextResponse } from 'next/server';
import alpaca from '@/lib/alpaca';

export async function GET() {
  try {
    const positions = await alpaca.getPositions();
    return NextResponse.json({ success: true, data: positions });
  } catch (error: any) {
    console.error('Error fetching positions:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
