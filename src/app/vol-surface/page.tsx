import VolatilitySurface3D from '@/components/VolatilitySurface3D';

export default function VolSurfacePage() {
  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 sm:mb-8">
          <h2 className="rv-h1">Volatility Surface</h2>
          <div className="rv-sub">3D visualization of implied volatility across strikes and expirations</div>
        </header>

        <VolatilitySurface3D initialTicker="CIFR" />

        <div className="mt-6 sm:mt-8 bg-[#2D2D2D] rounded-lg p-4 sm:p-6">
          <h3 className="text-lg sm:text-xl font-bold mb-4">Understanding the Vol Surface</h3>
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
