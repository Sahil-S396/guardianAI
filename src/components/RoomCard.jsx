import React, { useState, useEffect, useCallback } from 'react';
import { useHospital } from '../contexts/HospitalContext';
import { useAuth } from '../contexts/AuthContext';
import { formatZoneType } from '../utils/floorPublishing';
import { createEmergencyAlert } from '../utils/alertService';

const FALL_COUNTDOWN_SECONDS = 40;

const statusColors = {
  clear: 'room-clear',
  alert: 'room-alert',
  critical: 'room-critical',
};

const statusBg = {
  clear: 'bg-emerald-500/5',
  alert: 'bg-accent-amber/5',
  critical: 'bg-accent-red/5',
};

export default function RoomCard({ room, onDelete = null, deleting = false }) {
  const { hospitalId, drillMode } = useHospital();
  const { user } = useAuth();

  const [fallCountdown, setFallCountdown] = useState(null);
  const [triggering, setTriggering] = useState(null); // 'fire' | 'fall' | null
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(false);

  const handleCreateAlert = useCallback(async (alertType) => {
    setTriggering(alertType);
    setAlertError(null);
    setAlertSuccess(false);
    try {
      const secondsSinceTrigger = alertType === 'fall' ? FALL_COUNTDOWN_SECONDS : 0;
      await createEmergencyAlert({
        hospitalId,
        room,
        alertType,
        drillMode,
        userId: user?.uid || null,
        source: 'manual',
        secondsSinceTrigger,
      });
    } catch (err) {
      console.error('Failed to create alert:', err);
      setAlertError(err?.message || 'Failed to create alert. Check Firestore permissions.');
      setTimeout(() => setAlertError(null), 5000);
    } finally {
      setTriggering(null);
      setAlertSuccess(true);
      setTimeout(() => setAlertSuccess(false), 2000);
    }
  }, [drillMode, hospitalId, room, user]);

  useEffect(() => {
    if (fallCountdown === null) return undefined;

    const timer = setTimeout(() => {
      setFallCountdown((current) => {
        if (current === null) {
          return current;
        }
        if (current <= 1) {
          handleCreateAlert('fall');
          return null;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [fallCountdown, handleCreateAlert]);

  const handleFireTrigger = () => {
    setFallCountdown(null);
    handleCreateAlert('fire');
  };

  const handleFallTrigger = () => {
    setFallCountdown(FALL_COUNTDOWN_SECONDS);
  };

  const handleFallReset = () => {
    setFallCountdown(null);
  };

  const metaParts = [];
  if (room.zone && room.zone !== room.name) {
    metaParts.push(`Zone ${formatZoneType(room.zone)}`);
  }
  metaParts.push(`Floor ${room.floor}`);
  if (room.type && room.type !== room.zone) {
    metaParts.push(formatZoneType(room.type));
  }

  const normalizedStatus = (room.status || 'clear').toLowerCase();

  return (
    <div
      id={`room-card-${room.id}`}
      className={`glass-card p-4 flex flex-col gap-3 transition-all duration-300 ${statusColors[normalizedStatus] || 'room-clear'} ${statusBg[normalizedStatus] || 'bg-emerald-500/5'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{room.name}</h3>
          <p className="text-xs text-white/50 mt-0.5">{metaParts.join(' - ')}</p>
        </div>
        <StatusBadge status={normalizedStatus} />
      </div>

      {fallCountdown !== null && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-accent-amber font-semibold animate-blink">
              Fall detected - alerting in {fallCountdown}s
            </p>
            <button
              id={`room-${room.id}-fall-reset`}
              onClick={handleFallReset}
              className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70 hover:bg-white/20 transition"
            >
              Reset
            </button>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill bg-accent-amber"
              style={{ width: `${(fallCountdown / FALL_COUNTDOWN_SECONDS) * 100}%` }}
            />
          </div>
        </div>
      )}

      {alertError && (
        <p className="text-[10px] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded px-2 py-1">
          Warning: {alertError}
        </p>
      )}
      {alertSuccess && !alertError && (
        <p className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1">
          Alert triggered successfully
        </p>
      )}

      <div className="flex gap-2 mt-auto">
        <button
          id={`room-${room.id}-fire-btn`}
          onClick={handleFireTrigger}
          disabled={triggering !== null || deleting}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95
            ${drillMode
              ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30 hover:bg-accent-amber/30'
              : 'bg-accent-red/20 text-accent-red border border-accent-red/30 hover:bg-accent-red/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {triggering === 'fire' ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
            </svg>
          )}
          {drillMode ? 'Drill Fire' : 'Fire'}
        </button>

        <button
          id={`room-${room.id}-fall-btn`}
          onClick={handleFallTrigger}
          disabled={triggering !== null || deleting}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95
            bg-accent-amber/10 text-accent-amber border border-accent-amber/20 hover:bg-accent-amber/20
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {triggering === 'fall' ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          )}
          {drillMode ? 'Drill Fall' : 'Fall'}
        </button>
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting || triggering !== null}
          className="mt-1 w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete Room'}
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = (status || 'clear').toLowerCase();
  if (s === 'clear') return <span className="badge-clear"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Clear</span>;
  if (s === 'alert') return <span className="badge-alert"><span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />Alert</span>;
  if (s === 'critical') return <span className="badge-critical"><span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-ping" />Critical</span>;
  return <span className="badge-clear"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Clear</span>;
}
