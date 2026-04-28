import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useHospital } from '../../contexts/HospitalContext';
import {
  findNearestStaff,
  getEscalationRemainingMs,
} from '../../utils/staffTracker';

const roleAccent = {
  nurse: 'text-blue-300 border-blue-400/20 bg-blue-500/10',
  admin: 'text-purple-300 border-purple-400/20 bg-purple-500/10',
  security: 'text-accent-amber border-accent-amber/20 bg-accent-amber/10',
};

export default function ResponderPanel({ alert, room, title = 'Suggested Responder', compact = false }) {
  const { hospitalId } = useHospital();
  const [staff, setStaff] = useState([]);
  const [staffLocations, setStaffLocations] = useState([]);
  const [floorMaps, setFloorMaps] = useState([]);
  const [assigningId, setAssigningId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!hospitalId) {
      return undefined;
    }

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/staff`), (snap) => {
      setStaff(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) {
      return undefined;
    }

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/staffLocations`), (snap) => {
      setStaffLocations(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) {
      return undefined;
    }

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/floorMaps`), (snap) => {
      setFloorMaps(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId]);

  const ranking = useMemo(() => (
    findNearestStaff({
      hazardZoneId: alert?.hazardZoneId || alert?.roomMapNodeId || room?.mapNodeId,
      room,
      staff,
      staffLocations,
      floorMaps,
      now,
    })
  ), [alert?.hazardZoneId, alert?.roomMapNodeId, floorMaps, now, room, staff, staffLocations]);

  const remainingMs = getEscalationRemainingMs(alert, now);
  const countdownSeconds = Math.ceil(remainingMs / 1000);
  const progressPercent = Math.max(0, Math.min(100, (remainingMs / 90_000) * 100));
  const responders = ranking.ranked.slice(0, compact ? 3 : 5);
  const assignedStaffIds = alert?.assignedStaffIds || (alert?.assignedStaffId ? [alert.assignedStaffId] : []);
  if (alert?.acknowledgedBy && !assignedStaffIds.includes(alert.acknowledgedBy)) {
    assignedStaffIds.push(alert.acknowledgedBy);
  }
  
  const [assignRoleSelections, setAssignRoleSelections] = useState({});

  const handleRoleChange = (memberId, role) => {
    setAssignRoleSelections(prev => ({ ...prev, [memberId]: role }));
  };

  const [hasAutoCalled, setHasAutoCalled] = useState(false);
  const [show108Popup, setShow108Popup] = useState(false);
  const alertTime = alert?.createdAt?.toDate?.()?.getTime() || (alert?.createdAt?.seconds * 1000) || now;
  const ageMs = now - alertTime;
  const autoCallRemainingSeconds = Math.max(0, 90 - Math.floor(ageMs / 1000));

  useEffect(() => {
    if (!alert || assignedStaffIds.length > 0 || hasAutoCalled || alert.status === 'resolved') return;

    // 90 seconds = 90,000 milliseconds
    if (ageMs >= 90000) {
      setHasAutoCalled(true);
      setShow108Popup(true);
    }
  }, [alert, assignedStaffIds.length, hasAutoCalled, ageMs]);

  const handleAssign = async (member) => {
    if (!hospitalId || !alert?.id) {
      return;
    }

    setAssigningId(member.id);
    const selectedRole = assignRoleSelections[member.id] || 'Primary Responder';
    
    try {
      const alertPatch = {
        assignedStaffIds: arrayUnion(member.id),
        assignedStaffId: member.id, // Keep for backward compatibility
        assignedStaffName: member.name,
        assignedStaffRole: selectedRole,
        assignedAt: serverTimestamp(),
      };

      if (alert.status === 'active') {
        alertPatch.status = 'acknowledged';
        alertPatch.acknowledgedAt = serverTimestamp();
        alertPatch.acknowledgedBy = member.id;
      }

      await updateDoc(doc(db, `hospitals/${hospitalId}/alerts`, alert.id), alertPatch);
      await setDoc(
        doc(db, `hospitals/${hospitalId}/staff`, member.id),
        {
          available: member.available ?? true,
          assignedAlertId: alert.id,
          assignedAt: serverTimestamp(),
          lastAssignedRoomId: room?.id || alert.roomId || null,
        },
        { merge: true }
      );
      await setDoc(
        doc(db, `hospitals/${hospitalId}/staffLocations`, member.id),
        {
          available: member.available ?? true,
          assignedAlertId: alert.id,
          assignmentStatus: 'assigned',
          lastCheckInAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Assign responder failed:', error);
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className={`glass-card border border-white/10 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{title}</p>
          <h3 className="mt-1 text-lg font-semibold text-white">
            {responders[0]?.name || 'No nearby staff yet'}
          </h3>
          <p className="mt-1 text-sm text-white/50">
            {responders[0]
              ? `${responders[0].estimatedResponseTime} response from ${responders[0].distanceLabel.toLowerCase()}`
              : 'Waiting for a live check-in or simulation update.'}
          </p>
        </div>

        <div className="min-w-[100px] text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Auto-escalation</p>
          {alert?.status === 'active' ? (
            <p className={`mt-1 text-2xl font-black ${remainingMs > 15_000 ? 'text-accent-red' : 'text-orange-300'}`}>
              {countdownSeconds}s
            </p>
          ) : (
            <span className="mt-1.5 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-white/[0.06] text-white/60 border border-white/10">
              {alert?.status}
            </span>
          )}
        </div>
      </div>

      {alert?.status === 'active' && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-red via-orange-400 to-accent-amber transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {assignedStaffIds.length === 0 && alert?.status !== 'resolved' && (
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div>
            <p className="text-sm font-semibold text-red-300">No staff assigned to this alert</p>
            <p className="mt-1 text-xs text-red-400/80">Auto-calling 108 in: <span className="font-bold text-red-300">{autoCallRemainingSeconds}s</span></p>
          </div>
          <button 
            type="button"
            onClick={() => setShow108Popup(true)}
            className="shrink-0 w-full sm:w-auto text-center rounded-lg bg-red-600 px-6 py-2 text-sm font-bold tracking-widest text-white shadow-lg shadow-red-500/20 transition hover:bg-red-500"
          >
            CALL 108 NOW
          </button>
        </div>
      )}

      {responders.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm text-white/45">
          No available staff with a current location. Use the Check-in page to register staff, or switch to Simulation mode in the top bar.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {responders.map((member, index) => (
            <div
              key={member.id}
              className={`rounded-2xl border px-4 py-3 transition ${
                index === 0
                  ? 'border-emerald-400/20 bg-emerald-500/10'
                  : 'border-white/8 bg-white/[0.03]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{index + 1}. {member.name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${roleAccent[member.role] || 'border-white/10 bg-white/5 text-white/60'}`}>
                      {member.role || 'staff'}
                    </span>
                    {!member.isRecent && (
                      <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-300">
                        estimated
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-white/60">
                    {member.zone} · Floor {member.floor}
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    {member.distanceLabel} · ETA {member.estimatedResponseTime}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={assignRoleSelections[member.id] || 'Primary Responder'}
                    onChange={(e) => handleRoleChange(member.id, e.target.value)}
                    className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-xs text-white/75 outline-none focus:border-white/20"
                    disabled={assignedStaffIds.includes(member.id)}
                  >
                    <option value="Primary Responder">Primary</option>
                    <option value="Secondary Responder">Secondary</option>
                    <option value="Medical Support">Medical</option>
                    <option value="Security Detail">Security</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleAssign(member)}
                    disabled={assigningId === member.id || assignedStaffIds.includes(member.id)}
                    className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      assignedStaffIds.includes(member.id)
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                        : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {assignedStaffIds.includes(member.id)
                      ? 'Assigned'
                      : assigningId === member.id
                      ? 'Assigning...'
                      : 'Assign'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {show108Popup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center justify-center p-8 bg-red-900/90 rounded-3xl border-2 border-red-500 shadow-2xl shadow-red-500/50 max-w-sm w-full mx-4">
            <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center animate-pulse mb-6 shadow-lg shadow-red-600/50">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h2 className="text-3xl font-black text-white tracking-wider mb-2">CALLING 108...</h2>
            <p className="text-red-200 text-center text-sm mb-8">Connecting to emergency dispatch</p>
            <button 
              onClick={() => setShow108Popup(false)}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold transition"
            >
              Cancel Call (Demo)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
