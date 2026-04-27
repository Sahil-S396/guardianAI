import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from '../utils/time';

const typeColors = {
  fire: 'text-accent-red',
  fall: 'text-accent-amber',
};

const typeIcons = {
  fire: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
    </svg>
  ),
  fall: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
};

const statusBadge = {
  active: <span className="badge-active">Active</span>,
  acknowledged: <span className="badge-acknowledged">Acknowledged</span>,
  escalated: <span className="badge-escalated">Escalated</span>,
  contained: <span className="badge-alert">Contained</span>,
  resolved: <span className="badge-clear">Resolved</span>,
};

export default function AlertCard({ alert, isDrill }) {
  const navigate = useNavigate();
  const color = isDrill ? 'text-accent-amber' : typeColors[alert.type] || 'text-white';
  const border = isDrill
    ? 'border-accent-amber/30 hover:border-accent-amber/60'
    : alert.type === 'fire'
    ? 'border-accent-red/30 hover:border-accent-red/60'
    : 'border-accent-amber/30 hover:border-accent-amber/60';
  const time = alert.createdAt?.toDate?.() || new Date((alert.createdAt?.seconds || 0) * 1000);

  return (
    <div
      id={`alert-card-${alert.id}`}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/alerts/${alert.id}`)}
      onKeyDown={(event) => event.key === 'Enter' && navigate(`/alerts/${alert.id}`)}
      className={`glass-card cursor-pointer border p-4 transition-all duration-200 hover:shadow-glass ${border} animate-fade-in`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`mt-0.5 rounded-lg p-2 ${isDrill ? 'bg-accent-amber/10' : alert.type === 'fire' ? 'bg-accent-red/10' : 'bg-accent-amber/10'}`}>
            <span className={color}>{typeIcons[alert.type]}</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`text-sm font-semibold capitalize ${color}`}>
                {isDrill ? '[DRILL] ' : ''}{alert.type} Alert
              </h3>
              {alert.source === 'ai-monitor' && (
                <span className="rounded-full border border-accent-blue/30 bg-accent-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-blue">
                  AI Camera
                </span>
              )}
            </div>

            <p className="mt-0.5 truncate text-xs text-white/60">
              {alert.roomName || `Room ${alert.roomId}`} · {formatDistanceToNow(time)}
            </p>

            {alert.cameraLabel && (
              <p className="mt-1 text-[11px] text-white/35">{alert.cameraLabel}</p>
            )}

            {alert.geminiResponse?.immediateAction && (
              <p className="mt-1 line-clamp-2 text-xs text-white/40">
                {alert.geminiResponse.immediateAction}
              </p>
            )}
          </div>
        </div>

        {alert.status === 'resolved'
          ? statusBadge.resolved
          : alert.geminiResponse?.severity && (
              <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                alert.geminiResponse.severity === 'critical'
                  ? 'bg-accent-red/20 text-accent-red'
                  : alert.geminiResponse.severity === 'high'
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-accent-amber/20 text-accent-amber'
              }`}
              >
                {alert.geminiResponse.severity}
              </span>
            )}
      </div>
    </div>
  );
}
