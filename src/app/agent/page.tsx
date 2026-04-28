'use client';

import { useVegaEdgeSession } from '@/hooks/useVegaEdgeSession';
import ConnectionStatus from '@/components/agent/ConnectionStatus';
import VoiceControlBar from '@/components/agent/VoiceControlBar';
import SignalPanel from '@/components/agent/SignalPanel';
import WatchlistTable from '@/components/agent/WatchlistTable';
import TranscriptPanel from '@/components/agent/TranscriptPanel';
import LiveChart from '@/components/LiveChart';

export default function AgentPage() {
  const session = useVegaEdgeSession();

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 mb-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="rv-h1">VegaEdge Live Agent</h2>
            <ConnectionStatus
              connected={session.connected}
              listening={session.listening}
              error={session.error}
            />
          </div>
        </div>
        <div className="rv-sub">Real-time voice + vision options analyst</div>

        {/* Voice Control Bar */}
        <div className="mb-4 sm:mb-6">
          <VoiceControlBar
            connected={session.connected}
            listening={session.listening}
            error={session.error}
            onConnect={session.connect}
            onDisconnect={session.disconnect}
            onStartListening={session.startListening}
            onStopListening={session.stopListening}
            onSendText={session.sendText}
          />
        </div>

        {/* Chart + Signals grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6 mb-4 sm:mb-6">
          <div className="lg:col-span-2">
            <LiveChart
              data={session.chartData}
              ticker={session.chartTicker}
              history={session.chartHistory}
            />
          </div>
          <div className="lg:col-span-1">
            <SignalPanel signals={session.signals} />
          </div>
        </div>

        {/* Watchlist (conditional) */}
        {session.watchlistData && (
          <div className="mb-4 sm:mb-6">
            <WatchlistTable
              data={session.watchlistData}
              summary={session.watchlistSummary}
            />
          </div>
        )}

        {/* Transcript */}
        <TranscriptPanel transcript={session.transcript} />
      </div>
    </main>
  );
}
