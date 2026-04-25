import React, { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import AlertCard from '../components/AlertCard';
import { getFloorTileLabel, sortFloorLabels } from '../utils/floorPublishing';

const ALERT_LIMIT = 20;

function StatCard({ label, value, sub, color = 'text-white', glowClass = '' }) {
  return (
    <div className={`stat-card ${glowClass}`}>
      <p className="text-xs text-white/50 font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { hospitalId, drillMode } = useHospital();
  const [alerts, setAlerts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [publishedFloors, setPublishedFloors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');

  // Real-time alerts listener
  useEffect(() => {
    if (!hospitalId) return;
    const q = query(
      collection(db, `hospitals/${hospitalId}/alerts`),
      limit(ALERT_LIMIT)
    );
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Sort client-side to avoid needing a Firestore composite index
      docs.sort((a, b) => {
        const aTime = a.createdAt?.seconds ?? 0;
        const bTime = b.createdAt?.seconds ?? 0;
        return bTime - aTime;
      });
      setAlerts(docs);
      setLoading(false);
    });
    return unsub;
  }, [hospitalId]);

  // Rooms listener
  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/rooms`));
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [hospitalId]);

  // Staff listener
  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/staff`));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  const visibleAlerts = alerts.filter((a) => !a.archivedAt);
  const activeAlerts = visibleAlerts.filter((a) => a.status === 'active');
  const escalatedAlerts = visibleAlerts.filter((a) => a.status === 'escalated');
  const criticalRooms = visibleRooms.filter((r) => r.status === 'critical');
  const availableStaff = staff.filter((s) => s.available);

  const filteredAlerts = filterStatus === 'all'
    ? visibleAlerts
    : visibleAlerts.filter((a) => a.status === filterStatus);

  const drillAlerts = filteredAlerts.filter((a) => a.isDrill);
  const realAlerts = filteredAlerts.filter((a) => !a.isDrill);

  // Floor map data
  const floors = [...new Set(visibleRooms.map((r) => r.floor))].sort(sortFloorLabels);
  const floorMap = floors.map((floor) => ({
    floor,
    rooms: visibleRooms
      .filter((r) => r.floor === floor)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name || '').localeCompare(String(b.name || ''))),
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Alerts"
          value={activeAlerts.length}
          color={activeAlerts.length > 0 ? 'text-accent-red' : 'text-emerald-400'}
          glowClass={activeAlerts.length > 0 ? 'shadow-glow-red' : ''}
          sub={activeAlerts.length > 0 ? 'Needs immediate action' : 'All clear'}
        />
        <StatCard
          label="Escalated"
          value={escalatedAlerts.length}
          color={escalatedAlerts.length > 0 ? 'text-purple-400' : 'text-white'}
          sub="90s+ unacknowledged"
        />
        <StatCard
          label="Critical Rooms"
          value={criticalRooms.length}
          color={criticalRooms.length > 0 ? 'text-orange-400' : 'text-white'}
          sub={`of ${visibleRooms.length} total rooms`}
        />
        <StatCard
          label="Staff Available"
          value={availableStaff.length}
          color="text-accent-teal"
          sub={`of ${staff.length} total`}
        />
      </div>

      {/* Main grid: Alerts + Floor map */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Alert Feed */}
        <div className="xl:col-span-2 glass-card p-5">
          <div className="section-header">
            <div className="flex items-center gap-3">
              <h2 className="section-title">Live Alert Feed</h2>
              {loading && <div className="spinner w-4 h-4" />}
              {activeAlerts.length > 0 && (
                <span className="glow-dot-red animate-ping-slow" />
              )}
            </div>
            {/* Filter */}
            <select
              id="alert-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="guardian-select text-xs py-1.5 w-auto"
            >
              <option value="all">All Alerts</option>
              <option value="active">Active</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="escalated">Escalated</option>
              <option value="contained">Contained</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="spinner" />
              <p className="text-sm text-white/40">Loading alerts…</p>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <svg className="w-10 h-10 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-white/40">No alerts found</p>
              <p className="text-xs text-white/25">Trigger a fire or fall in Rooms to test</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {drillAlerts.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-accent-amber/60 uppercase tracking-wider mb-2">🎯 Drill Alerts</p>
                  {drillAlerts.map((a) => <AlertCard key={a.id} alert={a} isDrill />)}
                </div>
              )}
              {realAlerts.length > 0 && realAlerts.map((a) => (
                <AlertCard key={a.id} alert={a} isDrill={false} />
              ))}
            </div>
          )}
        </div>

        {/* Hospital Floor Map */}
        <div className="glass-card p-5">
          <div className="section-header">
            <h2 className="section-title">Floor Map</h2>
            <span className="text-xs text-white/40">{visibleRooms.length} rooms</span>
          </div>

          {floorMap.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-white/30">No published floor data yet</p>
              <p className="text-xs text-white/20 mt-1">Validate a floor in Map Editor and add it to the system.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {floorMap.map(({ floor, rooms: floorRooms }) => (
                <div key={floor}>
                  <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Floor {floor}</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {floorRooms.map((room) => (
                      <div
                        key={room.id}
                        title={`${room.name} — ${room.status}`}
                        className={`h-8 rounded flex items-center justify-center text-[9px] font-bold border transition-all duration-300 cursor-default
                          ${room.status === 'clear' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
                            room.status === 'alert' ? 'bg-accent-amber/30 border-accent-amber/40 text-accent-amber' :
                            'bg-accent-red/30 border-accent-red/40 text-accent-red animate-pulse'}
                        `}
                      >
                        {getFloorTileLabel(room)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Legend */}
              <div className="flex items-center gap-4 pt-2 border-t border-white/5">
                {[
                  { color: 'bg-emerald-500/40', label: 'Clear' },
                  { color: 'bg-accent-amber/40', label: 'Alert' },
                  { color: 'bg-accent-red/40', label: 'Critical' },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5 text-xs text-white/40">
                    <span className={`w-3 h-3 rounded ${l.color}`} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
