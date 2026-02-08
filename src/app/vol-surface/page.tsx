import VolatilitySurface3D from '@/components/VolatilitySurface3D';
import Link from 'next/link';

export default function VolSurfacePage() {
  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">Dashboard</Link>
            <span className="text-gray-600">/</span>
            <h1 className="text-4xl font-bold">Volatility Surface</h1>
          </div>
          <p className="text-gray-400">3D visualization of implied volatility across strikes and expirations</p>
        </header>

        <VolatilitySurface3D initialTicker="CIFR" />

        <div className="mt-8 bg-[#2D2D2D] rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4">Understanding the Vol Surface</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-300">
            <div>
              <h4 className="font-bold text-[#00C805] mb-2">Volatility Smile</h4>
              <p>OTM options tend to have higher IV than ATM, creating a U-shaped pattern.
              This reflects market demand for tail-risk protection.</p>
            </div>
            <div>
              <h4 className="font-bold text-[#FFD700] mb-2">Term Structure</h4>
              <p>IV varies with expiration. A normal term structure shows higher IV for longer
              expirations; an inverted structure suggests near-term uncertainty.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
