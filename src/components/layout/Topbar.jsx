import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useHospital } from '../../contexts/HospitalContext';
import { TRACKING_MODES } from '../../utils/staffTracker';

const routeLabels = {
  '/dashboard': 'Rehab Operations Dashboard',
  '/rooms': 'Rooms Management',
  '/staff': 'Staff Directory',
  '/drill': 'Drill Mode Simulator',
};

export default function Topbar() {
  const location = useLocation();
  const { hospitalId, drillMode, trackingMode, setTrackingMode } = useHospital();
  const [activeAlertCount, setActiveAlertCount] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/alerts`));
    const unsub = onSnapshot(q, (snap) => {
      const openCount = snap.docs.filter((docSnap) => {
        const data = docSnap.data();
        return !data.archivedAt && data.status !== 'resolved';
      }).length;
      setActiveAlertCount(openCount);
    });
    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pageTitle = location.pathname.startsWith('/alerts/')
    ? 'Alert Detail'
    : routeLabels[location.pathname] || 'GuardianAI';

  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <header className="shrink-0 h-14 px-6 flex items-center justify-between border-b border-white/[0.07] bg-navy-800/60 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-white">{pageTitle}</h2>
        {drillMode && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-accent-amber/20 text-accent-amber border border-accent-amber/30 animate-pulse">
            DRILL MODE
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden lg:flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setTrackingMode(TRACKING_MODES.LIVE)}
            className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition ${
              trackingMode === TRACKING_MODES.LIVE
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-white/45 hover:text-white/70'
            }`}
          >
            Live check-ins
          </button>
          <button
            type="button"
            onClick={() => setTrackingMode(TRACKING_MODES.SIMULATION)}
            className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition ${
              trackingMode === TRACKING_MODES.SIMULATION
                ? 'bg-accent-amber/20 text-accent-amber'
                : 'text-white/45 hover:text-white/70'
            }`}
          >
            Simulation
          </button>
        </div>

        {activeAlertCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-accent-red/10 border border-accent-red/30">
            <span className="glow-dot-red animate-ping-slow" />
            <span className="text-xs font-semibold text-accent-red">
              {activeAlertCount} OPEN {activeAlertCount === 1 ? 'ALERT' : 'ALERTS'}
            </span>
          </div>
        )}

        <div className="text-right hidden sm:block">
          <p className="text-xs font-mono text-white font-semibold">{timeStr}</p>
          <p className="text-[10px] text-white/40">{dateStr}</p>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <span className="glow-dot-green" />
          <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Systems Online</span>
        </div>
      </div>
    </header>
  );
}
