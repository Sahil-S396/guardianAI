import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { onAuthStateChanged, signInWithRedirect } from 'firebase/auth';
import { collection, onSnapshot, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import './index.css';
import {
  DEMO_STAFF,
  writeLocalStaffLocation,
} from './utils/staffTracker';

export function CheckInApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const zoneId = params.get('zone') || '';
  const floor = params.get('floor') || '';
  const zoneLabel = params.get('label') || zoneId || 'Unknown zone';
  const hospitalParam = params.get('hospital') || '';

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [staffOptions, setStaffOptions] = useState(DEMO_STAFF);
  const [selectedStaffId, setSelectedStaffId] = useState(DEMO_STAFF[0]?.id || '');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const hospitalId = hospitalParam || (user?.uid ? `hospital-${user.uid}` : '');

  useEffect(() => (
    onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    })
  ), []);

  useEffect(() => {
    if (!hospitalId || !user) {
      return undefined;
    }

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/staff`), (snap) => {
      if (snap.empty) {
        setStaffOptions(DEMO_STAFF);
        return;
      }

      const liveStaff = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      const merged = [...DEMO_STAFF];

      liveStaff.forEach((member) => {
        const existingIndex = merged.findIndex((entry) => entry.id === member.id);
        if (existingIndex >= 0) {
          merged[existingIndex] = { ...merged[existingIndex], ...member };
        } else {
          merged.push(member);
        }
      });

      setStaffOptions(merged);
      if (!merged.some((member) => member.id === selectedStaffId) && merged[0]) {
        setSelectedStaffId(merged[0].id);
      }
    });

    return unsub;
  }, [hospitalId, selectedStaffId, user]);

  const selectedStaff = staffOptions.find((member) => member.id === selectedStaffId) || staffOptions[0];

  const handleCheckIn = async () => {
    if (!selectedStaff || !hospitalId || !zoneId) {
      return;
    }

    setSubmitting(true);

    const localPayload = {
      staffId: selectedStaff.id,
      name: selectedStaff.name,
      role: selectedStaff.role || 'staff',
      floor,
      zone: zoneLabel,
      zoneId,
      mapNodeId: zoneId,
      available: true,
      locationSource: 'checkin',
      timestamp: new Date().toISOString(),
    };

    try {
      writeLocalStaffLocation(selectedStaff.id, localPayload);

      await setDoc(
        doc(db, `hospitals/${hospitalId}/staff`, selectedStaff.id),
        {
          name: selectedStaff.name,
          role: selectedStaff.role || 'staff',
          floor,
          zone: zoneLabel,
          zoneId,
          mapNodeId: zoneId,
          available: true,
          locationSource: 'checkin',
          lastCheckInAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, `hospitals/${hospitalId}/staffLocations`, selectedStaff.id),
        {
          staffId: selectedStaff.id,
          name: selectedStaff.name,
          role: selectedStaff.role || 'staff',
          floor,
          zone: zoneLabel,
          zoneId,
          mapNodeId: zoneId,
          available: true,
          locationSource: 'checkin',
          timestamp: serverTimestamp(),
          lastCheckInAt: serverTimestamp(),
        },
        { merge: true }
      );

      setConfirmation({
        name: selectedStaff.name,
        zone: zoneLabel,
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      });
    } catch (error) {
      console.error('Check-in failed:', error);
      setConfirmation({
        name: selectedStaff.name,
        zone: `${zoneLabel} (saved locally)`,
        time: 'just now',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-6">
        <div className="glass-card flex w-full max-w-sm flex-col items-center gap-3 p-6 text-center">
          <div className="spinner" />
          <p className="text-sm text-white/60">Loading check-in page...</p>
        </div>
      </div>
    );
  }

  if (!zoneId || !floor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-6">
        <div className="glass-card w-full max-w-sm p-6 text-center">
          <p className="text-lg font-semibold text-white">Missing QR details</p>
          <p className="mt-2 text-sm text-white/50">This check-in link needs both a zone and floor in the URL.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-6">
        <div className="glass-card w-full max-w-sm rounded-3xl p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">GuardianAI</p>
          <h1 className="mt-3 text-2xl font-bold text-white">Staff check-in</h1>
          <p className="mt-2 text-sm text-white/55">
            Sign in once on this device, then tap the room QR code to update your location instantly.
          </p>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left">
            <p className="text-xs uppercase tracking-[0.18em] text-white/35">Current QR</p>
            <p className="mt-2 text-sm font-semibold text-white">{zoneLabel}</p>
            <p className="mt-1 text-sm text-white/55">Floor {floor}</p>
          </div>
          <button
            type="button"
            onClick={() => signInWithRedirect(auth, googleProvider)}
            className="mt-5 w-full rounded-2xl border border-emerald-400/25 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
          >
            Sign in with Google
          </button>
          {!hospitalParam && (
            <p className="mt-3 text-xs text-orange-300/80">
              Tip: QR codes generated from the dashboard include the hospital ID automatically.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy px-4 py-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="glass-card rounded-[28px] p-5 shadow-glass">
          {!confirmation ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">GuardianAI Check-in</p>
              <h1 className="mt-2 text-3xl font-black text-white">I am here</h1>
              <p className="mt-2 text-sm text-white/55">
                Scan once when you move into a new room so the crisis dashboard can route the closest responder.
              </p>

              <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/35">Location</p>
                <p className="mt-2 text-lg font-semibold text-white">{zoneLabel}</p>
                <p className="mt-1 text-sm text-white/55">Floor {floor}</p>
              </div>

              <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-white/35" htmlFor="staff-member">
                Staff member
              </label>
              <select
                id="staff-member"
                value={selectedStaffId}
                onChange={(event) => setSelectedStaffId(event.target.value)}
                className="guardian-select mt-2 min-h-14 w-full rounded-2xl px-4 text-base"
              >
                {staffOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.role || 'staff'}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleCheckIn}
                disabled={submitting || !hospitalId}
                className="mt-5 min-h-16 w-full rounded-3xl border border-emerald-400/25 bg-emerald-500/15 px-4 text-lg font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Saving your location...' : "I'm here"}
              </button>
            </>
          ) : (
            <div className="py-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-500/15 text-2xl font-bold text-emerald-300">
                OK
              </div>
              <h2 className="mt-4 text-2xl font-bold text-white">Check-in saved</h2>
              <p className="mt-2 text-sm text-white/60">
                {confirmation.name} checked in to {confirmation.zone} at {confirmation.time}.
              </p>
              <button
                type="button"
                onClick={() => setConfirmation(null)}
                className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10"
              >
                Scan another room
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CheckInApp />
  </React.StrictMode>
);
