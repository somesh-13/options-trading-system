'use client';

interface ConnectionStatusProps {
  connected: boolean;
  listening: boolean;
  error: string | null;
}

export default function ConnectionStatus({ connected, listening, error }: ConnectionStatusProps) {
  if (error) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="inline-block w-2 h-2 rounded-full bg-[#FF006E]" />
        <span className="text-[#FF006E]">Error</span>
      </span>
    );
  }

  if (listening) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="relative inline-block w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-[#00C805]" />
          <span className="absolute inset-0 rounded-full bg-[#00C805] animate-ping" />
        </span>
        <span className="text-[#00C805]">Listening...</span>
      </span>
    );
  }

  if (connected) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="inline-block w-2 h-2 rounded-full bg-[#00C805]" />
        <span className="text-gray-400">Connected</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="inline-block w-2 h-2 rounded-full bg-gray-500" />
      <span className="text-gray-500">Disconnected</span>
    </span>
  );
}
