'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const WS_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000').replace(/^http/, 'ws') + '/ws/live'
    : 'ws://localhost:8000/ws/live';

const SAMPLE_RATE = 16000;

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
  connected: boolean;
  listening: boolean;
  error: string | null;
  signals: SignalEntry[];
  transcript: TranscriptEntry[];
  chartData: string | null;
  chartTicker: string;
  chartHistory: ChartHistoryEntry[];
  watchlistData: WatchlistEntry[] | null;
  watchlistSummary: string | null;
  connect: () => void;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
  sendText: (text: string) => void;
}

export function useVegaEdgeSession(): VegaEdgeSession {
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

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const nextPlayRef = useRef<number>(0);
  const playNextChunkRef = useRef<() => void>(() => {});

  useEffect(() => {
    playNextChunkRef.current = () => {
      const queue = audioQueueRef.current;
      if (queue.length === 0 || nextPlayRef.current > Date.now()) return;
      const bytes = queue.shift();
      if (!bytes) return;
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: 24000 });
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

  const connect = useCallback(() => {
    setError(null);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError('WebSocket error');
    ws.onmessage = (event) => {
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
          setTranscript((t) => [...t, { role: msg.role || 'model', text: msg.text, timestamp: new Date() }]);
        } else if (msg.type === 'signal' && msg.data) {
          const entry: SignalEntry = { ...msg.data, timestamp: new Date() };
          if (entry.watchlist) {
            setWatchlistData(entry.watchlist);
            setWatchlistSummary(entry.summary ?? null);
          }
          setSignals((s) => [...s, entry]);
        } else if (msg.type === 'error') {
          setError(msg.message ?? 'Error');
        }
      } catch {
        // ignore parse errors
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
    };
  }, []);

  const startListening = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1 } });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const b64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
        wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
      };
      src.connect(processor);
      processor.connect(ctx.destination);
      processorRef.current = processor;
      setListening(true);
    } catch {
      setError('Microphone access denied');
    }
  }, []);

  const stopListening = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setListening(false);
  }, []);

  const disconnect = useCallback(() => {
    stopListening();
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, [stopListening]);

  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'text', text }));
    setTranscript((t) => [...t, { role: 'user', text, timestamp: new Date() }]);
  }, []);

  return {
    connected,
    listening,
    error,
    signals,
    transcript,
    chartData,
    chartTicker,
    chartHistory,
    watchlistData,
    watchlistSummary,
    connect,
    disconnect,
    startListening,
    stopListening,
    sendText,
  };
}
