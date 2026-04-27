import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  deleteDoc,
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

  const [rooms, setRooms] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', employeeId: '', role: 'nurse', floor: '', zone: '' });
  const [adding, setAdding] = useState(false);

  // ── CONFLICT 2 RESOLVED: Both useEffects merged ──────────────────────────
  // Staff fetching (from main)
  useEffect(() => {
    if (!hospitalId) return undefined;
    const unsub = onSnapshot(
      query(collection(db, `hospitals/${hospitalId}/staff`), orderBy('name')),
      (snap) => {
        setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }
    );
    return unsub;
  }, [hospitalId]);

  // staffLocations fetching (from main)
  useEffect(() => {
    if (!hospitalId) return undefined;
    const unsub = onSnapshot(
      collection(db, `hospitals/${hospitalId}/staffLocations`),
      (snap) => {
        setStaffLocations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return unsub;
  }, [hospitalId]);

  // Rooms fetching (from feature/ayush)
  useEffect(() => {
    if (!hospitalId) return;
    const unsub = onSnapshot(
      collection(db, `hospitals/${hospitalId}/rooms`),
      (snap) => {
        setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    );
    return unsub;
  }, [hospitalId]);

  // ── CONFLICT 3 RESOLVED: main's useMemo staffRows kept ───────────────────
  const staffRows = useMemo(() => {
    const locationMap = new Map(staffLocations.map((l) => [l.staffId || l.id, l]));
    return staff.map((member) => {
      const live = locationMap.get(member.id);
      return {
        ...member,
        floor: live?.floor ?? member.floor ?? '-',
        zone: live?.zone ?? member.zone ?? 'Unknown',
        available: live?.available ?? member.available ?? true,
        locationSource: live?.locationSource || member.locationSource || 'directory',
      };
    });
  }, [staff, staffLocations]);

  const floors = [...new Set(staffRows.map((m) => m.floor).filter(Boolean))].sort();

  // Derived from rooms (feature/ayush)
  const availableFloors = [...new Set(rooms.map((r) => String(r.floor)))].sort();
  const selectedFloor = newStaff.floor || availableFloors[0] || '';
  const availableRoomsForFloor = rooms
    .filter((r) => String(r.floor) === selectedFloor)
    .sort((a, b) => (a.name || a.zone || '').localeCompare(b.name || b.zone || ''));

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
      await setDoc(
        doc(db, `hospitals/${hospitalId}/staffLocations`, member.id),
        { available: !member.available },
        { merge: true }
      );
    } catch (error) {
      console.error('Toggle availability failed:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  // Delete handler (from feature/ayush)
  const handleDeleteStaff = async (id) => {
    if (!window.confirm('Are you sure you want to delete this staff member?')) return;
    setUpdatingId(id);
    try {
      await deleteDoc(doc(db, `hospitals/${hospitalId}/staff`, id));
    } catch (err) {
      console.error('Failed to delete staff:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  // Add handler (from feature/ayush)
  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!newStaff.name || !newStaff.employeeId || !newStaff.role || !selectedFloor || !newStaff.zone) {
      alert('Please fill out all fields including Floor and Room!');
      return;
    }
    setAdding(true);
    try {
      await setDoc(doc(db, `hospitals/${hospitalId}/staff`, newStaff.employeeId), {
        name: newStaff.name,
        role: newStaff.role,
        floor: selectedFloor,
        zone: newStaff.zone,
        available: true,
      });
      setShowAddForm(false);
      setNewStaff({ name: '', employeeId: '', role: 'nurse', floor: '', zone: '' });
    } catch (err) {
      console.error('Failed to add staff:', err);
    } finally {
      setAdding(false);
    }
  };

  const available = staffRows.filter((m) => m.available).length;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── CONFLICT 4 RESOLVED: Both header sections merged ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Staff Directory</h1>
          <p className="mt-0.5 text-sm text-white/40">
            {staffRows.length} staff · {available} available · {staffRows.length - available} busy
          </p>
        </div>

        {/* Role breakdown + Add Staff button (feature/ayush) */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex gap-3">
            {['nurse', 'admin', 'security'].map((role) => {
              const count = staffRows.filter((s) => s.role === role).length;
              return (
                <div key={role} className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${roleColors[role]}`}>
                  {roleIcons[role]} {count} {role}s
                </div>
              );
            })}
          </div>
          <button onClick={() => setShowAddForm(true)} className="btn-primary !py-1.5 !text-xs">
            + Add Staff
          </button>
        </div>
      </div>

      {/* Tracking mode banner (main) */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Tracking mode</p>
          <p className="mt-1 text-sm text-white/65">
            {trackingMode === 'simulation'
              ? 'Simulation is moving stale staff every 30 seconds.'
              : 'Live check-ins are driving the responder list.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/checkin.html" className="btn-secondary text-xs">Open Check-in Page</a>
          <a href="/qr-generator.html" className="btn-secondary text-xs">Open QR Generator</a>
        </div>
      </div>

      {/* Add Staff Form (feature/ayush) */}
      {showAddForm && (
        <form onSubmit={handleAddStaff} className="glass-card p-4 space-y-4 shadow-xl border-accent-blue/30 bg-blue-500/5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Add New Staff Member</h3>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-white/40 hover:text-white transition">✕</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-semibold tracking-wider uppercase text-white/50 mb-1.5">Full Name</label>
              <input type="text" required value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} className="guardian-input py-2" placeholder="e.g. Sarah Connor" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-wider uppercase text-white/50 mb-1.5">Employee ID</label>
              <input type="text" required value={newStaff.employeeId} onChange={(e) => setNewStaff({ ...newStaff, employeeId: e.target.value })} className="guardian-input py-2" placeholder="e.g. EMP-1049" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-wider uppercase text-white/50 mb-1.5">Post / Role</label>
              <select value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })} className="guardian-select py-2">
                <option value="nurse">Nurse</option>
                <option value="admin">Admin</option>
                <option value="security">Security</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-wider uppercase text-white/50 mb-1.5">Floor</label>
              <select value={selectedFloor} onChange={(e) => setNewStaff({ ...newStaff, floor: e.target.value, zone: '' })} className="guardian-select py-2">
                {availableFloors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
                {availableFloors.length === 0 && <option value="" disabled>No Floors</option>}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-wider uppercase text-white/50 mb-1.5">Room / Zone</label>
              <select value={newStaff.zone} onChange={(e) => setNewStaff({ ...newStaff, zone: e.target.value })} className="guardian-select py-2">
                <option value="" disabled hidden>Select Room</option>
                {availableRoomsForFloor.map((r) => <option key={r.id} value={r.name || r.zone}>{r.name || r.zone}</option>)}
                {availableRoomsForFloor.length === 0 && <option value="" disabled>No Rooms</option>}
              </select>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button type="submit" disabled={adding} className="btn-primary">
              {adding ? 'Saving...' : 'Save Staff Member'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="glass-card p-4 flex flex-wrap gap-3">
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

                  {/* ── CONFLICT 5 RESOLVED: Toggle + Delete buttons (feature/ayush) ── */}
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        id={`staff-toggle-${member.id}`}
                        onClick={() => toggleAvailability(member)}
                        disabled={updatingId === member.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition disabled:opacity-50"
                      >
                        {updatingId === member.id ? '…' : member.available ? 'Mark Busy' : 'Mark Available'}
                      </button>
                      <button
                        onClick={() => handleDeleteStaff(member.id)}
                        disabled={updatingId === member.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
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