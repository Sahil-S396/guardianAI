import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';

const roleColors = {
  nurse: 'border-blue-500/20 bg-blue-500/10 text-blue-300',
  admin: 'border-purple-500/20 bg-purple-500/10 text-purple-300',
  security: 'border-accent-amber/20 bg-accent-amber/10 text-accent-amber',
};

const roleIcons = {
  nurse: 'RN',
  admin: 'MD',
  security: 'SEC',
};

export default function Staff() {
  const { hospitalId, trackingMode } = useHospital();
  const [staff, setStaff] = useState([]);
  const [staffLocations, setStaffLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterAvail, setFilterAvail] = useState('all');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsub = onSnapshot(
      query(collection(db, `hospitals/${hospitalId}/staff`), orderBy('name')),
      (snap) => {
        setStaff(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
        setLoading(false);
      }
    );

    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/staffLocations`), (snap) => {
      setStaffLocations(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId]);

  const staffRows = useMemo(() => {
    const locationMap = new Map(staffLocations.map((location) => [location.staffId || location.id, location]));
    return staff.map((member) => {
      const liveLocation = locationMap.get(member.id);
      return {
        ...member,
        floor: liveLocation?.floor ?? member.floor ?? '-',
        zone: liveLocation?.zone ?? member.zone ?? 'Unknown',
        available: liveLocation?.available ?? member.available ?? true,
        locationSource: liveLocation?.locationSource || member.locationSource || 'directory',
      };
    });
  }, [staff, staffLocations]);

  const floors = [...new Set(staffRows.map((member) => member.floor).filter(Boolean))].sort();

  const filtered = staffRows.filter((member) => {
    if (filterRole !== 'all' && member.role !== filterRole) return false;
    if (filterFloor !== 'all' && member.floor !== filterFloor) return false;
    if (filterAvail === 'available' && !member.available) return false;
    if (filterAvail === 'busy' && member.available) return false;
    if (search && !member.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleAvailability = async (member) => {
    setUpdatingId(member.id);
    try {
      await updateDoc(doc(db, `hospitals/${hospitalId}/staff`, member.id), {
        available: !member.available,
      });
      await setDoc(doc(db, `hospitals/${hospitalId}/staffLocations`, member.id), {
        available: !member.available,
      }, { merge: true });
    } catch (error) {
      console.error('Toggle availability failed:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  const available = staffRows.filter((member) => member.available).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Staff Directory</h1>
          <p className="mt-0.5 text-sm text-white/40">
            {staffRows.length} staff · {available} available · {staffRows.length - available} busy
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {['nurse', 'admin', 'security'].map((role) => {
            const count = staffRows.filter((member) => member.role === role).length;
            return (
              <div key={role} className={`rounded-lg border px-3 py-1.5 text-xs font-medium uppercase tracking-wider ${roleColors[role]}`}>
                {roleIcons[role]} {count} {role}
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Tracking mode</p>
          <p className="mt-1 text-sm text-white/65">
            {trackingMode === 'simulation' ? 'Simulation is moving stale staff every 30 seconds.' : 'Live check-ins are driving the responder list.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/checkin.html" className="btn-secondary text-xs">
            Open Check-in Page
          </a>
          <a href="/qr-generator.html" className="btn-secondary text-xs">
            Open QR Generator
          </a>
        </div>
      </div>

      <div className="glass-card flex flex-wrap gap-3 p-4">
        <input
          id="staff-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search staff..."
          className="guardian-input min-w-[180px] flex-1"
        />
        <select id="staff-filter-role" value={filterRole} onChange={(event) => setFilterRole(event.target.value)} className="guardian-select">
          <option value="all">All Roles</option>
          <option value="nurse">Nurse</option>
          <option value="admin">Admin</option>
          <option value="security">Security</option>
        </select>
        <select id="staff-filter-floor" value={filterFloor} onChange={(event) => setFilterFloor(event.target.value)} className="guardian-select">
          <option value="all">All Floors</option>
          {floors.map((floor) => <option key={floor} value={floor}>Floor {floor}</option>)}
        </select>
        <select id="staff-filter-avail" value={filterAvail} onChange={(event) => setFilterAvail(event.target.value)} className="guardian-select">
          <option value="all">All Availability</option>
          <option value="available">Available</option>
          <option value="busy">Busy</option>
        </select>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <div className="spinner" />
            <p className="text-sm text-white/40">Loading staff...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/40">No staff match your filters.</p>
            {staffRows.length === 0 && (
              <p className="mt-2 text-xs text-white/25">Use the QR check-in page to create hackathon demo staff on the fly.</p>
            )}
          </div>
        ) : (
          <table className="guardian-table">
            <thead>
              <tr>
                <th>Staff Member</th>
                <th>Role</th>
                <th>Zone</th>
                <th>Floor</th>
                <th>Source</th>
                <th>Availability</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id} className={!member.available ? 'opacity-60' : ''}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-bold ${roleColors[member.role] || 'border-white/10 bg-white/5 text-white/70'}`}>
                        {roleIcons[member.role] || (member.name?.[0] ?? '?')}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{member.name}</p>
                        <p className="font-mono text-xs text-white/40">{member.id}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider ${roleColors[member.role] || 'border-white/10 bg-white/5 text-white/70'}`}>
                      {member.role || 'staff'}
                    </span>
                  </td>
                  <td><span className="text-sm text-white/70">{member.zone}</span></td>
                  <td><span className="text-sm text-white/70">Floor {member.floor}</span></td>
                  <td>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                      {member.locationSource || 'directory'}
                    </span>
                  </td>
                  <td>
                    {member.available ? (
                      <span className="badge-clear">Available</span>
                    ) : (
                      <span className="badge-alert">Busy</span>
                    )}
                  </td>
                  <td>
                    <button
                      id={`staff-toggle-${member.id}`}
                      onClick={() => toggleAvailability(member)}
                      disabled={updatingId === member.id}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      {updatingId === member.id ? 'Updating...' : member.available ? 'Mark Busy' : 'Mark Available'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
