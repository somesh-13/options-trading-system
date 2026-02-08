import Alpaca from '@alpacahq/alpaca-trade-api';

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
  throw new Error('Alpaca API credentials are missing');
}

export const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true, // Paper trading
  usePolygon: false,
});

export default alpaca;
