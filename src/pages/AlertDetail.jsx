import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import { useAuth } from '../contexts/AuthContext';
import { formatTimestamp, formatDistanceToNow } from '../utils/time';

export default function AlertDetail() {
  const { alertId } = useParams();
  const { hospitalId } = useHospital();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [alert, setAlert] = useState(null);
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [containing, setContaining] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!alertId || !hospitalId) return;
    const ref = doc(db, `hospitals/${hospitalId}/alerts`, alertId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setAlert({ id: snap.id, ...snap.data() });
      }
      setLoading(false);
    });
    return unsub;
  }, [alertId, hospitalId]);

  useEffect(() => {
    if (!alert?.roomId || !hospitalId) return;
    const fetchRoom = async () => {
      try {
        const roomRef = doc(db, `hospitals/${hospitalId}/rooms`, alert.roomId);
        const snap = await getDoc(roomRef);
        if (snap.exists()) setRoom({ id: snap.id, ...snap.data() });
      } catch {}
    };
    fetchRoom();
  }, [alert?.roomId, hospitalId]);

  const updateAlertLifecycle = async (alertPatch, roomPatch) => {
    await updateDoc(doc(db, `hospitals/${hospitalId}/alerts`, alertId), alertPatch);
    if (alert?.roomId && roomPatch) {
      await updateDoc(doc(db, `hospitals/${hospitalId}/rooms`, alert.roomId), roomPatch);
    }
  };

  const handleAcknowledge = async () => {
    setAcknowledging(true);
    try {
      await updateAlertLifecycle({
        status: 'acknowledged',
        acknowledgedBy: user?.uid || null,
        acknowledgedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Acknowledge failed:', err);
    } finally {
      setAcknowledging(false);
    }
  };

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      await updateAlertLifecycle({
        status: 'escalated',
        escalatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Escalate failed:', err);
    } finally {
      setEscalating(false);
    }
  };

  const handleContain = async () => {
    setContaining(true);
    try {
      await updateAlertLifecycle(
        {
          status: 'contained',
          severity: 'medium',
          containedAt: serverTimestamp(),
          containedBy: user?.uid || null,
        },
        { status: 'alert' }
      );
    } catch (err) {
      console.error('Contain failed:', err);
    } finally {
      setContaining(false);
    }
  };

  const handleResolve = async () => {
    setResolving(true);
    try {
      await updateAlertLifecycle(
        {
          status: 'resolved',
          severity: 'low',
          resolvedAt: serverTimestamp(),
          resolvedBy: user?.uid || null,
        },
        { status: 'clear' }
      );
    } catch (err) {
      console.error('Resolve failed:', err);
    } finally {
      setResolving(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await updateDoc(doc(db, `hospitals/${hospitalId}/alerts`, alertId), {
        archivedAt: serverTimestamp(),
        archivedBy: user?.uid || null,
      });
      navigate('/dashboard');
    } catch (err) {
      console.error('Archive failed:', err);
    } finally {
      setArchiving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="spinner" />
        <p className="text-white/40 text-sm">Loading alert...</p>
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="text-center py-20">
        <p className="text-white/40 text-lg">Alert not found</p>
        <button className="btn-secondary mt-4" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  const isFire = alert.type === 'fire';
  const accentClass = alert.isDrill ? 'text-accent-amber' : isFire ? 'text-accent-red' : 'text-accent-amber';
  const borderClass = alert.isDrill ? 'border-accent-amber/30' : isFire ? 'border-accent-red/30' : 'border-accent-amber/30';
  const bgGlow = alert.isDrill ? 'bg-drill-glow' : isFire ? 'bg-alert-glow' : '';
  const gemini = alert.geminiResponse;
  const alertTime = alert.createdAt?.toDate?.() || new Date(alert.createdAt?.seconds * 1000 || Date.now());
  const canEscalate = !['escalated', 'resolved'].includes(alert.status);
  const canContain = ['active', 'acknowledged', 'escalated'].includes(alert.status);
  const canResolve = alert.status !== 'resolved';

  return (
    <div className={`space-y-6 animate-fade-in ${bgGlow}`}>
      <button
        id="alert-detail-back-btn"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className={`glass-card p-6 border ${borderClass}`}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <span className={`text-2xl font-black uppercase ${accentClass}`}>
                {alert.isDrill ? '[DRILL] ' : ''}{alert.type} ALERT
              </span>
              <StatusBadge status={alert.status} />
            </div>
            <p className="text-sm text-white/60">
              Alert ID: <span className="font-mono text-white/40 text-xs">{alertId}</span>
            </p>
          </div>
          <div className="text-right text-xs text-white/40">
            <p>{formatTimestamp(alert.createdAt)}</p>
            <p className="mt-0.5">{formatDistanceToNow(alertTime)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Location</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: 'Room', value: room?.name || alert.roomId },
                { label: 'Zone', value: room?.zone || '-' },
                { label: 'Floor', value: room?.floor || '-' },
                { label: 'Room Type', value: room?.type || '-' },
                { label: 'Event Type', value: alert.type?.toUpperCase() },
                { label: 'Severity', value: gemini?.severity?.toUpperCase() || alert.severity?.toUpperCase() || '-' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-white/40">{label}</p>
                  <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {gemini ? (
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-white">Gemini AI Response</h2>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  AI Generated
                </span>
              </div>

              <div className="space-y-4">
                <div className={`p-4 rounded-lg border ${isFire || alert.isDrill ? 'bg-accent-red/5 border-accent-red/20' : 'bg-accent-amber/5 border-accent-amber/20'}`}>
                  <p className="text-xs text-white/50 uppercase tracking-wider mb-1">Immediate Action</p>
                  <p className="text-sm text-white font-medium">{gemini.immediateAction}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-white/40">Suggested Responder</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{gemini.suggestedResponder}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/40">Est. Response Time</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{gemini.estimatedResponseTime}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/40">Evacuation Required</p>
                    <p className={`text-sm font-semibold mt-0.5 ${gemini.evacuationRequired ? 'text-accent-red' : 'text-emerald-400'}`}>
                      {gemini.evacuationRequired ? 'YES - Evacuate Now' : 'No'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-white/40">AI Severity</p>
                    <p className={`text-sm font-bold mt-0.5 uppercase ${
                      gemini.severity === 'critical' ? 'text-accent-red' :
                      gemini.severity === 'high' ? 'text-orange-400' :
                      gemini.severity === 'medium' ? 'text-accent-amber' : 'text-emerald-400'
                    }`}>{gemini.severity}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card p-5 flex items-center gap-3">
              <div className="spinner w-5 h-5" />
              <p className="text-sm text-white/50">Gemini AI is processing this alert...</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Actions</h2>
            <div className="space-y-2">
              {alert.status === 'active' && (
                <button
                  id="alert-acknowledge-btn"
                  onClick={handleAcknowledge}
                  disabled={acknowledging}
                  className="btn-secondary w-full justify-center disabled:opacity-50"
                >
                  {acknowledging ? 'Acknowledging...' : 'Acknowledge Alert'}
                </button>
              )}
              {canEscalate && (
                <button
                  id="alert-escalate-btn"
                  onClick={handleEscalate}
                  disabled={escalating}
                  className="btn-danger w-full justify-center disabled:opacity-50"
                >
                  {escalating ? 'Escalating...' : 'Escalate Alert'}
                </button>
              )}
              {canContain && (
                <button
                  id="alert-contain-btn"
                  onClick={handleContain}
                  disabled={containing}
                  className="btn-secondary w-full justify-center disabled:opacity-50"
                >
                  {containing ? 'Marking Contained...' : 'Fire Controlled - Lower Priority'}
                </button>
              )}
              {canResolve && (
                <button
                  id="alert-resolve-btn"
                  onClick={handleResolve}
                  disabled={resolving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold transition hover:bg-emerald-500/15 disabled:opacity-50"
                >
                  {resolving ? 'Resolving...' : 'Resolve And Clear Area'}
                </button>
              )}
              {alert.status === 'contained' && (
                <p className="text-center text-xs text-accent-amber">Incident contained. Room remains under observation.</p>
              )}
              {alert.status === 'resolved' && (
                <p className="text-center text-xs text-emerald-400">Incident resolved. Room cleared.</p>
              )}
              {alert.status === 'resolved' && !alert.archivedAt && (
                <button
                  id="alert-archive-btn"
                  onClick={handleArchive}
                  disabled={archiving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/15 bg-white/5 text-white/70 font-semibold transition hover:bg-white/10 disabled:opacity-50"
                >
                  {archiving ? 'Removing...' : 'Remove Alert From Feed'}
                </button>
              )}
            </div>
          </div>

          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Escalation Chain</h2>
            <div className="space-y-3">
              <TimelineItem step="1" label="Alert Triggered" time={formatTimestamp(alert.createdAt)} done />
              <TimelineItem
                step="2"
                label="Gemini AI Triage"
                time={gemini ? 'Completed' : 'In progress...'}
                done={!!gemini}
                inProgress={!gemini}
              />
              <TimelineItem
                step="3"
                label="Staff Notified"
                time={alert.geminiResponse ? gemini?.suggestedResponder : '-'}
                done={!!gemini}
              />
              <TimelineItem
                step="4"
                label="Acknowledged"
                time={formatTimestamp(alert.acknowledgedAt)}
                done={['acknowledged', 'escalated', 'contained', 'resolved'].includes(alert.status)}
              />
              <TimelineItem
                step="5"
                label="Escalated"
                time={formatTimestamp(alert.escalatedAt)}
                done={['escalated', 'contained', 'resolved'].includes(alert.status)}
              />
              <TimelineItem
                step="6"
                label="Contained"
                time={formatTimestamp(alert.containedAt)}
                done={['contained', 'resolved'].includes(alert.status)}
              />
              <TimelineItem
                step="7"
                label="Resolved"
                time={formatTimestamp(alert.resolvedAt)}
                done={alert.status === 'resolved'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: 'badge-active',
    acknowledged: 'badge-acknowledged',
    escalated: 'badge-escalated',
    contained: 'badge-alert',
    resolved: 'badge-clear',
  };
  return <span className={map[status] || 'badge-active'}>{status}</span>;
}

function TimelineItem({ step, label, time, done, inProgress }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5 border
        ${done ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' :
          inProgress ? 'bg-accent-amber/20 border-accent-amber/40 text-accent-amber animate-pulse' :
          'bg-white/5 border-white/10 text-white/30'}`}
      >
        {done ? '✓' : step}
      </div>
      <div>
        <p className={`text-xs font-medium ${done ? 'text-white' : 'text-white/40'}`}>{label}</p>
        {time && <p className="text-[10px] text-white/30 mt-0.5">{time}</p>}
      </div>
    </div>
  );
}
