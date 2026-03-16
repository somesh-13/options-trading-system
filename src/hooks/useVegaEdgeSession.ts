'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const WS_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_PRICING_API_URL || 'http://localhost:8000').replace(/^http/, 'ws')
    : 'ws://localhost:8000';

const SAMPLE_RATE = 16000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]; // exponential backoff

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
  opportunity?: string | { direction?: string; option_type?: string; strike?: number; ev_per_contract?: number; premium_estimate?: number };
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
  isSpeaking: boolean;
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
  startListening: () => void;
  stopListening: () => void;
  stopSpeaking: () => void;
  sendText: (text: string) => void;
  sendChatMessage: (text: string) => void;
  clearLiveText: () => void;
}

export function useVegaEdgeSession(): VegaEdgeSession {
  const [mode, setModeState] = useState<AgentMode>('chat');
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
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
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const nextPlayRef = useRef<number>(0);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playNextChunkRef = useRef<() => void>(() => {});
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const interruptedRef = useRef(false);
  const interruptResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingNewResponseRef = useRef(false);
  const speakingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumingRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const mountedRef = useRef(true);
  const wasListeningRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => {});
  const connectToWsRef = useRef<(mode: AgentMode) => void>(() => {});

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

  const flushPlayback = useCallback(() => {
    audioQueueRef.current.length = 0;
    for (const src of activeSourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    activeSourcesRef.current.clear();
    if (playbackCtxRef.current) {
      nextPlayRef.current = playbackCtxRef.current.currentTime;
    }
    // Bypass debounce — stop immediately
    if (speakingEndTimerRef.current) {
      clearTimeout(speakingEndTimerRef.current);
      speakingEndTimerRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    interruptedRef.current = true;
    flushPlayback();
    // Notify backend
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    // Safety: reset after 3s in case turn_complete never arrives
    if (interruptResetTimerRef.current) clearTimeout(interruptResetTimerRef.current);
    interruptResetTimerRef.current = setTimeout(() => {
      interruptedRef.current = false;
      interruptResetTimerRef.current = null;
    }, 3000);
  }, [flushPlayback]);

  // Audio playback engine
  useEffect(() => {
    playNextChunkRef.current = () => {
      const queue = audioQueueRef.current;
      if (queue.length === 0) {
        // Debounce: wait 300ms before declaring speech ended
        if (speakingEndTimerRef.current) clearTimeout(speakingEndTimerRef.current);
        speakingEndTimerRef.current = setTimeout(() => {
          if (audioQueueRef.current.length === 0 && activeSourcesRef.current.size === 0) {
            setIsSpeaking(false);
          }
        }, 300);
        return;
      }

      try {
        if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
          playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
        }
        const ctx = playbackCtxRef.current;

        if (ctx.state === 'suspended') {
          // Guard: only register one resume callback
          if (!resumingRef.current) {
            resumingRef.current = true;
            ctx.resume().then(() => {
              resumingRef.current = false;
              playNextChunkRef.current();
            }).catch(() => { resumingRef.current = false; });
          }
          return;
        }

        // Cancel any pending "speaking ended" timer
        if (speakingEndTimerRef.current) {
          clearTimeout(speakingEndTimerRef.current);
          speakingEndTimerRef.current = null;
        }
        setIsSpeaking(true);

        while (queue.length > 0) {
          const bytes = queue.shift();
          if (!bytes || bytes.length < 2) continue;
          const evenLen = bytes.length - (bytes.length % 2);
          const sampleCount = evenLen / 2;
          if (sampleCount === 0) continue;
          const buf = ctx.createBuffer(1, sampleCount, 24000);
          const channel = buf.getChannelData(0);
          const view = new DataView(bytes.buffer, bytes.byteOffset, evenLen);
          for (let i = 0; i < sampleCount; i++) {
            channel[i] = view.getInt16(i * 2, true) / 32768;
          }
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          const startTime = Math.max(nextPlayRef.current, ctx.currentTime);
          src.start(startTime);
          nextPlayRef.current = startTime + buf.duration;
          activeSourcesRef.current.add(src);
          src.onended = () => {
            activeSourcesRef.current.delete(src);
            if (audioQueueRef.current.length === 0 && activeSourcesRef.current.size === 0) {
              // Debounce: wait 300ms before declaring speech ended
              if (speakingEndTimerRef.current) clearTimeout(speakingEndTimerRef.current);
              speakingEndTimerRef.current = setTimeout(() => {
                if (audioQueueRef.current.length === 0 && activeSourcesRef.current.size === 0) {
                  setIsSpeaking(false);
                }
              }, 300);
            }
          };
        }
      } catch (e) {
        console.error('Audio playback error:', e);
        setIsSpeaking(false);
      }
    };
  });

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'interrupted') {
        interruptedRef.current = true;
        flushPlayback();
        // Safety timer (turn_complete should follow, but just in case)
        if (interruptResetTimerRef.current) clearTimeout(interruptResetTimerRef.current);
        interruptResetTimerRef.current = setTimeout(() => {
          interruptedRef.current = false;
          interruptResetTimerRef.current = null;
        }, 3000);
        return;
      }
      if (msg.type === 'turn_complete') {
        interruptedRef.current = false;
        awaitingNewResponseRef.current = true;
        if (interruptResetTimerRef.current) {
          clearTimeout(interruptResetTimerRef.current);
          interruptResetTimerRef.current = null;
        }
        if (audioQueueRef.current.length === 0 && activeSourcesRef.current.size === 0) {
          setIsSpeaking(false);
        }
        return;
      }
      if (msg.type === 'audio' && msg.data) {
        if (awaitingNewResponseRef.current) {
          interruptedRef.current = false;
          awaitingNewResponseRef.current = false;
        }
        if (interruptedRef.current) return; // drop stale chunks after interruption
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
          interruptedRef.current = false; // reset so next AI response has audio
          liveUserTextRef.current = msg.text;
          setLiveUserText(msg.text);
        } else {
          flushLiveText();
          if (modeRef.current === 'chat') {
            if (msg.done) {
              setStreamingModelText('');
              setIsAgentThinking(false);
              setTranscript((t) => [...t, { role: 'model', text: msg.text, timestamp: new Date() }]);
            } else {
              setStreamingModelText((prev) => prev + msg.text);
              setIsAgentThinking(false);
            }
          } else {
            setTranscript((t) => {
              const last = t[t.length - 1];
              if (last && last.role === 'model') {
                const updated = [...t];
                updated[updated.length - 1] = { ...last, text: last.text + msg.text };
                return updated;
              }
              return [...t, { role: 'model', text: msg.text, timestamp: new Date() }];
            });
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
  }, [flushLiveText, flushPlayback]);

  // Connect to WebSocket with auto-reconnect
  const connectToWs = useCallback((wsMode: AgentMode) => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setError(null);
    intentionalCloseRef.current = false;
    const wsPath = wsMode === 'chat' ? '/ws/chat' : '/ws/live';
    const ws = new WebSocket(WS_BASE + wsPath);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setError(null);
      reconnectAttemptRef.current = 0; // Reset backoff on successful connect

      // Auto-resume mic if it was active before disconnect
      if (wasListeningRef.current) {
        wasListeningRef.current = false;
        setTimeout(() => {
          if (mountedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            startListeningRef.current();
          }
        }, 100);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      setIsAgentThinking(false);
      wsRef.current = null;

      // Remember if mic was active before disconnect
      wasListeningRef.current = mediaStreamRef.current !== null;

      // Clean up mic resources (audio going nowhere without WS)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (captureCtxRef.current) {
        captureCtxRef.current.close();
        captureCtxRef.current = null;
      }
      setListening(false);

      // Auto-reconnect unless intentionally closed (removed ev.code !== 1000)
      if (!intentionalCloseRef.current) {
        const attempt = reconnectAttemptRef.current;
        const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current && !intentionalCloseRef.current) {
            reconnectAttemptRef.current++;
            connectToWs(modeRef.current);
          }
        }, delay);
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setError('Connection error — retrying...');
    };

    ws.onmessage = handleMessage;
  }, [handleMessage]);
  connectToWsRef.current = connectToWs;

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connectToWs(modeRef.current);

    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      if (speakingEndTimerRef.current) clearTimeout(speakingEndTimerRef.current);
      if (interruptResetTimerRef.current) clearTimeout(interruptResetTimerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      captureCtxRef.current?.close();
      playbackCtxRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const setMode = useCallback((newMode: AgentMode) => {
    if (newMode === modeRef.current) return;
    const wasListening = mediaStreamRef.current !== null;
    if (wasListening) stopListening();
    modeRef.current = newMode;
    setModeState(newMode);

    // Reconnect to the appropriate endpoint
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    // Small delay then reconnect to new endpoint
    setTimeout(() => {
      intentionalCloseRef.current = false;
      connectToWs(newMode);
    }, 100);
  }, [stopListening, connectToWs]);

  const startListening = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      wasListeningRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      connectToWsRef.current(modeRef.current);
      return;
    }
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
  startListeningRef.current = startListening;

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
    isSpeaking,
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
    startListening,
    stopListening,
    stopSpeaking,
    sendText,
    sendChatMessage,
    clearLiveText,
  };
}
