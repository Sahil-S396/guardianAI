import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';

const roleColors = {
  nurse: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  admin: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  security: 'text-accent-amber bg-accent-amber/10 border-accent-amber/20',
};

const roleIcons = {
  nurse: '🏥',
  admin: '👔',
  security: '🔒',
};

export default function Staff() {
  const { hospitalId } = useHospital();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterAvail, setFilterAvail] = useState('all');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/staff`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [hospitalId]);

  const floors = [...new Set(staff.map((s) => s.floor))].sort();

  const filtered = staff.filter((s) => {
    if (filterRole !== 'all' && s.role !== filterRole) return false;
    if (filterFloor !== 'all' && s.floor !== filterFloor) return false;
    if (filterAvail === 'available' && !s.available) return false;
    if (filterAvail === 'busy' && s.available) return false;
    if (search && !s.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleAvailability = async (staffMember) => {
    setUpdatingId(staffMember.id);
    try {
      await updateDoc(doc(db, `hospitals/${hospitalId}/staff`, staffMember.id), {
        available: !staffMember.available,
      });
    } catch (err) {
      console.error('Toggle availability failed:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const available = staff.filter((s) => s.available).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Staff Directory</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {staff.length} staff · {available} available · {staff.length - available} busy
          </p>
        </div>
        {/* Role breakdown */}
        <div className="flex gap-3">
          {['nurse', 'admin', 'security'].map((role) => {
            const count = staff.filter((s) => s.role === role).length;
            return (
              <div key={role} className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${roleColors[role]}`}>
                {roleIcons[role]} {count} {role}s
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-wrap gap-3">
        <input
          id="staff-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff…"
          className="guardian-input flex-1 min-w-[180px]"
        />
        <select id="staff-filter-role" value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="guardian-select">
          <option value="all">All Roles</option>
          <option value="nurse">Nurse</option>
          <option value="admin">Admin</option>
          <option value="security">Security</option>
        </select>
        <select id="staff-filter-floor" value={filterFloor} onChange={(e) => setFilterFloor(e.target.value)} className="guardian-select">
          <option value="all">All Floors</option>
          {floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
        </select>
        <select id="staff-filter-avail" value={filterAvail} onChange={(e) => setFilterAvail(e.target.value)} className="guardian-select">
          <option value="all">All Availability</option>
          <option value="available">Available</option>
          <option value="busy">Busy</option>
        </select>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="spinner" />
            <p className="text-sm text-white/40">Loading staff…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center p-12">
            <p className="text-white/40">No staff match your filters.</p>
            {staff.length === 0 && (
              <p className="text-white/25 text-xs mt-2">Seed Firestore with staff data to get started.</p>
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
                <th>Availability</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id} className={`${!member.available ? 'opacity-60' : ''}`}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border ${roleColors[member.role]}`}>
                        {member.name?.[0] ?? '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{member.name}</p>
                        <p className="text-xs text-white/40 font-mono">{member.id.slice(0, 8)}…</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${roleColors[member.role]}`}>
                      {roleIcons[member.role]} {member.role}
                    </span>
                  </td>
                  <td><span className="text-sm text-white/70">Zone {member.zone}</span></td>
                  <td><span className="text-sm text-white/70">Floor {member.floor}</span></td>
                  <td>
                    {member.available ? (
                      <span className="badge-clear">● Available</span>
                    ) : (
                      <span className="badge-alert">● Busy</span>
                    )}
                  </td>
                  <td>
                    <button
                      id={`staff-toggle-${member.id}`}
                      onClick={() => toggleAvailability(member)}
                      disabled={updatingId === member.id}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition disabled:opacity-50"
                    >
                      {updatingId === member.id ? '…' : member.available ? 'Mark Busy' : 'Mark Available'}
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
