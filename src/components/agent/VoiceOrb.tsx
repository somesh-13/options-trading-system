'use client';

interface VoiceOrbProps {
  listening: boolean;
  isSpeaking: boolean;
  connected: boolean;
  onToggle: () => void;
  onStop?: () => void;
}

export default function VoiceOrb({ listening, isSpeaking, connected, onToggle, onStop }: VoiceOrbProps) {
  const isActive = listening || isSpeaking;

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Orb container */}
      <div className="relative">
        {/* Outer pulsing rings — only when active */}
        {isActive && (
          <>
            <span
              className="absolute inset-[-20px] rounded-full border border-[#00C805]/20 pointer-events-none"
              style={{ animation: 'orb-ring 2s ease-out infinite' }}
            />
            <span
              className="absolute inset-[-40px] rounded-full border border-[#00C805]/10 pointer-events-none"
              style={{ animation: 'orb-ring 2s ease-out 0.5s infinite' }}
            />
            <span
              className="absolute inset-[-60px] rounded-full border border-[#00C805]/5 pointer-events-none"
              style={{ animation: 'orb-ring 2s ease-out 1s infinite' }}
            />
          </>
        )}

        {/* Glow effect */}
        {isActive && (
          <span
            className="absolute inset-[-8px] rounded-full pointer-events-none"
            style={{
              background: listening
                ? 'radial-gradient(circle, rgba(0,200,5,0.3) 0%, transparent 70%)'
                : 'radial-gradient(circle, rgba(0,200,5,0.15) 0%, transparent 70%)',
              animation: 'orb-glow 1.5s ease-in-out infinite alternate',
            }}
          />
        )}

        {/* Main orb button */}
        <button
          type="button"
          onClick={isSpeaking && onStop ? onStop : onToggle}
          disabled={!connected}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${
            listening && !isSpeaking
              ? 'bg-[#00C805] shadow-[0_0_40px_rgba(0,200,5,0.4)] scale-110'
              : isSpeaking
                ? 'bg-[#FF006E]/90 shadow-[0_0_30px_rgba(255,0,110,0.3)] hover:bg-[#FF006E]'
                : connected
                  ? 'bg-[#2D2D2D] hover:bg-[#3D3D3D] hover:shadow-[0_0_20px_rgba(0,200,5,0.15)] hover:scale-105'
                  : 'bg-[#2D2D2D] opacity-50 cursor-not-allowed'
          }`}
        >
          {isSpeaking ? (
            /* Stop square icon when AI is speaking */
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="none">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : listening ? (
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={connected ? '#00C805' : '#666'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
      </div>

      {/* Status text */}
      <p className={`text-sm font-medium transition-colors ${
        isSpeaking ? 'text-[#FF006E]' : listening ? 'text-[#00C805]' : 'text-gray-500'
      }`}>
        {isSpeaking
          ? 'Tap to stop'
          : listening
            ? 'Listening...'
            : connected
              ? 'Tap to speak'
              : 'Connecting...'}
      </p>

      {/* CSS animations */}
      <style jsx>{`
        @keyframes orb-ring {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes orb-glow {
          0% { transform: scale(1); opacity: 0.7; }
          100% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes sound-bar {
          0% { transform: scaleY(0.5); }
          100% { transform: scaleY(1.3); }
        }
      `}</style>
    </div>
  );
}
