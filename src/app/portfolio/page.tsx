import { redirect } from 'next/navigation';

// /portfolio used to be a separate Robinhood-derived NAV+Greeks summary; its
// content has been folded into /robinhood (Portfolio + Analytics views), which
// is the multi-account broker view. Keep this redirect so any bookmarks /
// external links still land on the live data.
export default function PortfolioPage() {
  redirect('/robinhood');
}
