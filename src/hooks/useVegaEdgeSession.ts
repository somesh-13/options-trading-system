'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const WS_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000').replace(/^http/, 'ws')
    : 'ws://localhost:8000';

const SAMPLE_RATE = 16000;

export type AgentMode = 'chat' | 'voice';

export interface TranscriptEntry {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface SignalEntry {
  ticker?: string;
  signal?: string;
  iv_hv_ratio?: number;
  spot_price?: number;
  historical_vol?: number;
  implied_vol_atm?: number;
  expiration?: string;
  atm_strike?: number;
  opportunity?: string;
  timestamp?: Date;
  watchlist?: Array<{ ticker: string; signal: string; iv_hv_ratio?: number; spot_price?: number }>;
  summary?: string;
}

export interface ChartHistoryEntry {
  data: string;
  ticker: string;
  timestamp: Date;
}

export interface WatchlistEntry {
  ticker: string;
  signal: string;
  iv_hv_ratio?: number;
  spot_price?: number;
}

export interface VegaEdgeSession {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  connected: boolean;
  listening: boolean;
  error: string | null;
  signals: SignalEntry[];
  transcript: TranscriptEntry[];
  liveUserText: string;
  chartData: string | null;
  chartTicker: string;
  chartHistory: ChartHistoryEntry[];
  watchlistData: WatchlistEntry[] | null;
  watchlistSummary: string | null;
  streamingModelText: string;
  isAgentThinking: boolean;
  connect: () => void;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
  sendText: (text: string) => void;
  sendChatMessage: (text: string) => void;
  clearLiveText: () => void;
}

export function useVegaEdgeSession(): VegaEdgeSession {
  const [mode, setModeState] = useState<AgentMode>('chat');
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [chartData, setChartData] = useState<string | null>(null);
  const [chartTicker, setChartTicker] = useState('');
  const [chartHistory, setChartHistory] = useState<ChartHistoryEntry[]>([]);
  const [signals, setSignals] = useState<SignalEntry[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [watchlistData, setWatchlistData] = useState<WatchlistEntry[] | null>(null);
  const [watchlistSummary, setWatchlistSummary] = useState<string | null>(null);
  const [liveUserText, setLiveUserText] = useState('');
  const [streamingModelText, setStreamingModelText] = useState('');
  const [isAgentThinking, setIsAgentThinking] = useState(false);

  const liveUserTextRef = useRef('');
  const modeRef = useRef<AgentMode>('chat');

  const flushLiveText = useCallback(() => {
    const text = liveUserTextRef.current;
    if (text) {
      setTranscript((t) => [...t, { role: 'user', text, timestamp: new Date() }]);
      liveUserTextRef.current = '';
      setLiveUserText('');
    }
  }, []);

  const clearLiveText = useCallback(() => {
    liveUserTextRef.current = '';
    setLiveUserText('');
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const nextPlayRef = useRef<number>(0);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playNextChunkRef = useRef<() => void>(() => {});

  useEffect(() => {
    playNextChunkRef.current = () => {
      const queue = audioQueueRef.current;
      if (queue.length === 0 || nextPlayRef.current > Date.now()) return;
      const bytes = queue.shift();
      if (!bytes) return;
      if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
        playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const ctx = playbackCtxRef.current;
      const buf = ctx.createBuffer(1, bytes.length / 2, 24000);
      const channel = buf.getChannelData(0);
      const view = new DataView(bytes.buffer ?? new ArrayBuffer(0), bytes.byteOffset ?? 0, bytes.byteLength ?? 0);
      for (let i = 0; i < channel.length; i++) {
        channel[i] = view.getInt16(i * 2, true) / 32768;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      nextPlayRef.current = Date.now() + (buf.duration * 1000);
      if (queue.length > 0) setTimeout(() => playNextChunkRef.current(), 50);
    };
  });

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'audio' && msg.data) {
        audioQueueRef.current.push(Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)));
        playNextChunkRef.current();
      } else if (msg.type === 'chart') {
        const data = msg.data ?? null;
        const ticker = msg.ticker ?? '';
        setChartData(data);
        setChartTicker(ticker);
        if (data) {
          setChartHistory((h) => [...h.slice(-9), { data, ticker, timestamp: new Date() }]);
        }
      } else if (msg.type === 'transcript' && msg.text) {
        if (msg.role === 'user') {
          // Voice mode: live transcription from Gemini
          liveUserTextRef.current = msg.text;
          setLiveUserText(msg.text);
        } else {
          flushLiveText();
          if (modeRef.current === 'chat') {
            // Chat mode: handle streaming with done flag
            if (msg.done) {
              // Final message — add to transcript, clear streaming state
              setStreamingModelText('');
              setIsAgentThinking(false);
              setTranscript((t) => [...t, { role: 'model', text: msg.text, timestamp: new Date() }]);
            } else {
              // Partial streaming chunk
              setStreamingModelText((prev) => prev + msg.text);
              setIsAgentThinking(false);
            }
          } else {
            // Voice mode: direct transcript
            setTranscript((t) => [...t, { role: 'model', text: msg.text, timestamp: new Date() }]);
          }
        }
      } else if (msg.type === 'signal' && msg.data) {
        const entry: SignalEntry = { ...msg.data, timestamp: new Date() };
        if (entry.watchlist) {
          setWatchlistData(entry.watchlist);
          setWatchlistSummary(entry.summary ?? null);
        }
        setSignals((s) => [...s, entry]);
      } else if (msg.type === 'error') {
        setError(msg.message ?? 'Error');
        setIsAgentThinking(false);
      }
    } catch {
      // ignore parse errors
    }
  }, [flushLiveText]);

  const connectToWs = useCallback((wsMode: AgentMode) => {
    setError(null);
    const wsPath = wsMode === 'chat' ? '/ws/chat' : '/ws/live';
    const ws = new WebSocket(WS_BASE + wsPath);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setIsAgentThinking(false);
    };
    ws.onerror = () => setError('WebSocket error');
    ws.onmessage = handleMessage;
  }, [handleMessage]);

  const connect = useCallback(() => {
    connectToWs(modeRef.current);
  }, [connectToWs]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      captureCtxRef.current?.close();
      playbackCtxRef.current?.close();
    };
  }, []);

  const stopListening = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    captureCtxRef.current?.close();
    captureCtxRef.current = null;
    setListening(false);
  }, []);

  const disconnect = useCallback(() => {
    stopListening();
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setIsAgentThinking(false);
    setStreamingModelText('');
  }, [stopListening]);

  const setMode = useCallback((newMode: AgentMode) => {
    if (newMode === modeRef.current) return;
    modeRef.current = newMode;
    setModeState(newMode);
    // Reconnect to the appropriate endpoint
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      disconnect();
      // Small delay to ensure clean disconnect before reconnecting
      setTimeout(() => connectToWs(newMode), 100);
    }
  }, [disconnect, connectToWs]);

  const startListening = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1 } });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      captureCtxRef.current = ctx;

      const processorCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0]?.[0];
            if (input) {
              const pcm = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) {
                const s = Math.max(-1, Math.min(1, input[i]));
                pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              this.port.postMessage(pcm.buffer, [pcm.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PCMProcessor);
      `;
      const blob = new Blob([processorCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor');
      workletNode.port.onmessage = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const b64 = btoa(String.fromCharCode(...new Uint8Array(e.data as ArrayBuffer)));
        wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
      };

      const src = ctx.createMediaStreamSource(stream);
      src.connect(workletNode);
      workletNodeRef.current = workletNode;
      setListening(true);
    } catch {
      setError('Microphone access denied');
    }
  }, []);

  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'text', text }));
    setTranscript((t) => [...t, { role: 'user', text, timestamp: new Date() }]);
    liveUserTextRef.current = '';
    setLiveUserText('');
  }, []);

  const sendChatMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'text', text }));
    setTranscript((t) => [...t, { role: 'user', text, timestamp: new Date() }]);
    setIsAgentThinking(true);
    setStreamingModelText('');
  }, []);

  return {
    mode,
    setMode,
    connected,
    listening,
    error,
    signals,
    transcript,
    liveUserText,
    chartData,
    chartTicker,
    chartHistory,
    watchlistData,
    watchlistSummary,
    streamingModelText,
    isAgentThinking,
    connect,
    disconnect,
    startListening,
    stopListening,
    sendText,
    sendChatMessage,
    clearLiveText,
  };
}
