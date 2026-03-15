'use client';

import { useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useVegaEdgeSession } from '@/hooks/useVegaEdgeSession';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import ConnectionStatus from '@/components/agent/ConnectionStatus';
import VoiceControlBar from '@/components/agent/VoiceControlBar';
import SignalPanel from '@/components/agent/SignalPanel';
import WatchlistTable from '@/components/agent/WatchlistTable';
import TranscriptPanel from '@/components/agent/TranscriptPanel';
import LiveChart from '@/components/LiveChart';
import type { AgentMode } from '@/hooks/useVegaEdgeSession';

export default function AgentClient() {
  const session = useVegaEdgeSession();
  const speech = useSpeechRecognition();

  // When speech recognition produces a final result, auto-send it
  useEffect(() => {
    if (speech.finalText && session.connected && session.mode === 'chat') {
      session.sendChatMessage(speech.finalText);
      speech.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.finalText]);

  const handleMicPress = useCallback(() => {
    speech.start();
  }, [speech]);

  const handleMicRelease = useCallback(() => {
    speech.stop();
  }, [speech]);

  const handleModeChange = useCallback((newMode: AgentMode) => {
    if (speech.isListening) speech.stop();
    session.setMode(newMode);
  }, [speech, session]);

  const hasData = session.chartData || session.signals.length > 0 || session.watchlistData;

  return (
    <main className="min-h-screen bg-[#1E1E1E] text-white flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-gray-400 hover:text-white transition-colors">
                &larr;
              </Link>
              <h1 className="text-3xl font-bold">VegaEdge</h1>
              <ConnectionStatus
                connected={session.connected}
                listening={session.listening}
                error={session.error}
              />
            </div>

            {/* Mode toggle */}
            <div className="flex items-center gap-1 bg-[#2D2D2D] rounded-lg p-1">
              <button
                type="button"
                onClick={() => handleModeChange('chat')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  session.mode === 'chat'
                    ? 'bg-[#00C805] text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('voice')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  session.mode === 'voice'
                    ? 'bg-[#00C805] text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Voice
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 px-6 pb-2 overflow-hidden">
        <div className="max-w-7xl mx-auto h-full flex flex-col lg:flex-row gap-4">
          {/* Chat area — dominant */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-hidden">
              <div className="h-full [&>div]:h-full [&>div]:flex [&>div]:flex-col">
                <TranscriptPanel
                  transcript={session.transcript}
                  streamingModelText={session.streamingModelText}
                  isAgentThinking={session.isAgentThinking}
                />
              </div>
            </div>
          </div>

          {/* Sidebar: charts, signals, watchlist — collapsible on mobile */}
          {hasData && (
            <div className="lg:w-[380px] flex-shrink-0 space-y-4 overflow-y-auto">
              {session.chartData && (
                <LiveChart
                  data={session.chartData}
                  ticker={session.chartTicker}
                  history={session.chartHistory}
                />
              )}
              {session.signals.length > 0 && (
                <SignalPanel signals={session.signals} />
              )}
              {session.watchlistData && (
                <WatchlistTable
                  data={session.watchlistData}
                  summary={session.watchlistSummary}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input bar — fixed at bottom */}
      <div className="px-6 pb-4 pt-2">
        <div className="max-w-7xl mx-auto">
          <VoiceControlBar
            mode={session.mode}
            connected={session.connected}
            listening={session.listening}
            error={session.error}
            liveUserText={session.liveUserText}
            isAgentThinking={session.isAgentThinking}
            isSpeechListening={speech.isListening}
            isSpeechSupported={speech.isSupported}
            speechInterimText={speech.interimText}
            onConnect={session.connect}
            onDisconnect={session.disconnect}
            onStartListening={session.startListening}
            onStopListening={session.stopListening}
            onSendText={session.sendText}
            onSendChatMessage={session.sendChatMessage}
            onMicPress={handleMicPress}
            onMicRelease={handleMicRelease}
            onClearLiveText={session.clearLiveText}
          />
        </div>
      </div>
    </main>
  );
}
