'use client';

import Link from 'next/link';
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
    <main className="min-h-screen bg-[#1E1E1E] text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              &larr;
            </Link>
            <h1 className="text-3xl font-bold">VegaEdge Live Agent</h1>
            <ConnectionStatus
              connected={session.connected}
              listening={session.listening}
              error={session.error}
            />
          </div>
          <p className="text-gray-500 text-sm">
            Real-time voice + vision options analyst
          </p>
        </div>

        {/* Voice Control Bar */}
        <div className="mb-6">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
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
          <div className="mb-6">
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
