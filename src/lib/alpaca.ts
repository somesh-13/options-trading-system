import Alpaca from '@alpacahq/alpaca-trade-api';

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
  console.warn('Alpaca API credentials are missing — Alpaca API routes will not work');
}

export const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY || '',
  secretKey: process.env.ALPACA_SECRET_KEY || '',
  paper: true,
  usePolygon: false,
});

export default alpaca;
