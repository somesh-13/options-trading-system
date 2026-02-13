'use client';

import { useEffect, useState } from 'react';
import type { Alert } from '@/hooks/useAlerts';

interface ToastProps {
  alerts: Alert[];
  onDismiss: (id: string) => void;
}

export default function Toast({ alerts, onDismiss }: ToastProps) {
  const visible = alerts.slice(0, 3);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {visible.map((alert) => (
        <ToastItem key={alert.id} alert={alert} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ alert, onDismiss }: { alert: Alert; onDismiss: (id: string) => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setShow(true));
    const timer = setTimeout(() => {
      setShow(false);
      setTimeout(() => onDismiss(alert.id), 300);
    }, 8000);
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  const borderColor =
    alert.severity === 'danger' ? 'border-[#FF006E]' :
    alert.severity === 'success' ? 'border-[#00C805]' :
    'border-[#FFD700]';

  const bgColor =
    alert.severity === 'danger' ? 'bg-[#FF006E]/10' :
    alert.severity === 'success' ? 'bg-[#00C805]/10' :
    'bg-[#FFD700]/10';

  return (
    <div
      className={`${bgColor} border-l-4 ${borderColor} bg-[#2D2D2D] rounded-r-lg p-4 shadow-lg transition-all duration-300 ${
        show ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-white">{alert.message}</p>
          <p className="text-xs text-gray-400 mt-1">
            {alert.timestamp.toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={() => {
            setShow(false);
            setTimeout(() => onDismiss(alert.id), 300);
          }}
          className="text-gray-400 hover:text-white text-lg leading-none"
        >
          x
        </button>
      </div>
    </div>
  );
}
