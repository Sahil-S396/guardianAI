import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import RoomCard from '../components/RoomCard';

export default function Rooms() {
  const { hospitalId, drillMode } = useHospital();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/rooms`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [hospitalId]);

  const floors = [...new Set(rooms.map((r) => r.floor))].sort();
  const zones = [...new Set(rooms.map((r) => r.zone))].sort();

  const filtered = rooms.filter((r) => {
    if (filterFloor !== 'all' && r.floor !== filterFloor) return false;
    if (filterZone !== 'all' && r.zone !== filterZone) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (search && !r.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const clearCount = rooms.filter((r) => r.status === 'clear').length;
  const alertCount = rooms.filter((r) => r.status === 'alert').length;
  const criticalCount = rooms.filter((r) => r.status === 'critical').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Rooms Management</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {rooms.length} rooms · {clearCount} clear · {alertCount} alert · {criticalCount} critical
          </p>
        </div>
        {drillMode && (
          <div className="px-3 py-2 rounded-lg bg-accent-amber/10 border border-accent-amber/30 flex items-center gap-2">
            <span className="glow-dot-amber animate-ping-slow" />
            <span className="text-sm font-semibold text-accent-amber">Drill Mode — No real alerts</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-wrap gap-3">
        <input
          id="rooms-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rooms…"
          className="guardian-input flex-1 min-w-[180px]"
        />
        <select
          id="rooms-filter-floor"
          value={filterFloor}
          onChange={(e) => setFilterFloor(e.target.value)}
          className="guardian-select min-w-[130px]"
        >
          <option value="all">All Floors</option>
          {floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
        </select>
        <select
          id="rooms-filter-zone"
          value={filterZone}
          onChange={(e) => setFilterZone(e.target.value)}
          className="guardian-select min-w-[130px]"
        >
          <option value="all">All Zones</option>
          {zones.map((z) => <option key={z} value={z}>Zone {z}</option>)}
        </select>
        <select
          id="rooms-filter-status"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="guardian-select min-w-[130px]"
        >
          <option value="all">All Status</option>
          <option value="clear">Clear</option>
          <option value="alert">Alert</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Room grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="spinner" />
          <p className="text-sm text-white/40">Loading rooms…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-white/40 text-sm">No rooms match your filters.</p>
          {rooms.length === 0 && (
            <p className="text-white/25 text-xs mt-2">
              Seed Firestore with room data to get started.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </div>
  );
}
