import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import RoomCard from '../components/RoomCard';
import { formatZoneType, sortFloorLabels } from '../utils/floorPublishing';

export default function Rooms() {
  const { hospitalId, drillMode } = useHospital();
  const [rooms, setRooms] = useState([]);
  const [publishedFloors, setPublishedFloors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterFloor, setFilterFloor] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [deletingRoomId, setDeletingRoomId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/rooms`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/floorMaps`));
    const unsub = onSnapshot(q, (snap) => {
      setPublishedFloors(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
    return unsub;
  }, [hospitalId]);

  const publishedFloorSet = new Set(
    publishedFloors.map((floorDoc) => String(floorDoc.floor ?? floorDoc.floorNumber ?? ''))
  );
  const visibleRooms = publishedFloorSet.size > 0
    ? rooms.filter((room) => publishedFloorSet.has(String(room.floor)))
    : rooms;

  const floors = [...new Set(visibleRooms.map((room) => room.floor))].sort(sortFloorLabels);
  const zones = [...new Set(visibleRooms.map((room) => room.zone))].sort();

  const filtered = visibleRooms.filter((room) => {
    if (filterFloor !== 'all' && room.floor !== filterFloor) return false;
    if (filterZone !== 'all' && room.zone !== filterZone) return false;
    if (filterStatus !== 'all' && room.status !== filterStatus) return false;
    if (search && !room.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const clearCount = visibleRooms.filter((room) => room.status === 'clear').length;
  const alertCount = visibleRooms.filter((room) => room.status === 'alert').length;
  const criticalCount = visibleRooms.filter((room) => room.status === 'critical').length;

  const handleDeleteRoom = async (room) => {
    if (!hospitalId) return;

    if (confirmDeleteId !== room.id) {
      setConfirmDeleteId(room.id);
      return;
    }

    setConfirmDeleteId(null);
    setDeletingRoomId(room.id);
    try {
      await deleteDoc(doc(db, `hospitals/${hospitalId}/rooms`, room.id));
    } catch (error) {
      console.error('Failed to delete room:', error);
    } finally {
      setDeletingRoomId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Rooms Management</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {visibleRooms.length} rooms - {clearCount} clear - {alertCount} alert - {criticalCount} critical
          </p>
        </div>
        {drillMode && (
          <div className="px-3 py-2 rounded-lg bg-accent-amber/10 border border-accent-amber/30 flex items-center gap-2">
            <span className="glow-dot-amber animate-ping-slow" />
            <span className="text-sm font-semibold text-accent-amber">Drill Mode - No real alerts</span>
          </div>
        )}
      </div>

      <div className="glass-card p-4 flex flex-wrap gap-3">
        <input
          id="rooms-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rooms..."
          className="guardian-input flex-1 min-w-[180px]"
        />
        <select
          id="rooms-filter-floor"
          value={filterFloor}
          onChange={(e) => setFilterFloor(e.target.value)}
          className="guardian-select min-w-[130px]"
        >
          <option value="all">All Floors</option>
          {floors.map((floor) => <option key={floor} value={floor}>Floor {floor}</option>)}
        </select>
        <select
          id="rooms-filter-zone"
          value={filterZone}
          onChange={(e) => setFilterZone(e.target.value)}
          className="guardian-select min-w-[130px]"
        >
          <option value="all">All Zones</option>
          {zones.map((zone) => <option key={zone} value={zone}>Zone {formatZoneType(zone)}</option>)}
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

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="spinner" />
          <p className="text-sm text-white/40">Loading rooms...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-white/40 text-sm">No rooms match your filters.</p>
          {visibleRooms.length === 0 && (
            <p className="text-white/25 text-xs mt-2">
              Publish a floor from the Map Editor to populate live rooms.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              deleting={deletingRoomId === room.id}
              confirmingDelete={confirmDeleteId === room.id}
              onDelete={() => handleDeleteRoom(room)}
              onCancelDelete={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
