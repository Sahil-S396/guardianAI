import React, { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import AlertCard from '../components/AlertCard';
import ResponderPanel from '../components/staff/ResponderPanel';
import { getFloorTileLabel, sortFloorLabels } from '../utils/floorPublishing';

const ALERT_LIMIT = 20;

function StatCard({ label, value, sub, color = 'text-white', glowClass = '' }) {
  return (
    <div className={`stat-card ${glowClass}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-white/50">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { hospitalId } = useHospital();
  const [alerts, setAlerts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [publishedFloors, setPublishedFloors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsub = onSnapshot(
      query(
        collection(db, `hospitals/${hospitalId}/alerts`),
        limit(ALERT_LIMIT)
      ),
      (snap) => {
        const docs = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        docs.sort((a, b) => {
          const aTime = a.createdAt?.seconds ?? 0;
          const bTime = b.createdAt?.seconds ?? 0;
          return bTime - aTime;
        });
        setAlerts(docs);
        setLoading(false);
      }
    );

    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/rooms`), (snap) => {
      setRooms(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/staff`), (snap) => {
      setStaff(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/floorMaps`), (snap) => {
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

  const visibleAlerts = alerts.filter((alert) => !alert.archivedAt);
  const activeAlerts = visibleAlerts.filter((alert) => alert.status === 'active');
  const escalatedAlerts = visibleAlerts.filter((alert) => alert.status === 'escalated');
  const criticalRooms = visibleRooms.filter((room) => room.status === 'critical');
  const availableStaff = staff.filter((member) => member.available);

  const filteredAlerts = filterStatus === 'all'
    ? visibleAlerts
    : visibleAlerts.filter((alert) => alert.status === filterStatus);

  const drillAlerts = filteredAlerts.filter((alert) => alert.isDrill);
  const realAlerts = filteredAlerts.filter((alert) => !alert.isDrill);
  const priorityAlert = activeAlerts[0] || escalatedAlerts[0] || null;
  const priorityRoom = priorityAlert
    ? {
        id: priorityAlert.roomId,
        name: priorityAlert.roomName || priorityAlert.roomId,
        floor: priorityAlert.roomFloor || priorityAlert.floor || '',
        zone: priorityAlert.roomZone || priorityAlert.zone || '',
        mapNodeId: priorityAlert.roomMapNodeId || priorityAlert.hazardZoneId || null,
      }
    : null;

  const floors = [...new Set(visibleRooms.map((room) => room.floor))].sort(sortFloorLabels);
  const floorMap = floors.map((floor) => ({
    floor,
    rooms: visibleRooms
      .filter((room) => room.floor === floor)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name || '').localeCompare(String(b.name || ''))),
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="glass-card p-5 xl:col-span-2">
          <div className="section-header">
            <div className="flex items-center gap-3">
              <h2 className="section-title">Live Alert Feed</h2>
              {loading && <div className="spinner h-4 w-4" />}
              {activeAlerts.length > 0 && <span className="glow-dot-red animate-ping-slow" />}
            </div>

            <select
              id="alert-filter-select"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              className="guardian-select w-auto py-1.5 text-xs"
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
            <div className="flex h-48 flex-col items-center justify-center gap-3">
              <div className="spinner" />
              <p className="text-sm text-white/40">Loading alerts...</p>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <svg className="h-10 w-10 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-white/40">No alerts found</p>
              <p className="text-xs text-white/25">Trigger a fire or fall in Rooms to test</p>
            </div>
          ) : (
            <div className="max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {drillAlerts.length > 0 && (
                <div className="mb-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-amber/60">Drill Alerts</p>
                  {drillAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} isDrill />)}
                </div>
              )}
              {realAlerts.length > 0 && realAlerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} isDrill={false} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="glass-card p-5">
            <div className="section-header">
              <h2 className="section-title">Floor Map</h2>
              <span className="text-xs text-white/40">{visibleRooms.length} rooms</span>
            </div>

            {floorMap.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-white/30">No published floor data yet</p>
                <p className="mt-1 text-xs text-white/20">Validate a floor in Map Editor and add it to the system.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {floorMap.map(({ floor, rooms: floorRooms }) => (
                  <div key={floor}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50">Floor {floor}</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {floorRooms.map((room) => (
                        <div
                          key={room.id}
                          title={`${room.name} - ${room.status}`}
                          className={`flex h-8 cursor-default items-center justify-center rounded border text-[9px] font-bold transition-all duration-300
                            ${room.status === 'clear' ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-400' :
                              room.status === 'alert' ? 'border-accent-amber/40 bg-accent-amber/30 text-accent-amber' :
                              'animate-pulse border-accent-red/40 bg-accent-red/30 text-accent-red'}
                          `}
                        >
                          {getFloorTileLabel(room)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="flex items-center gap-4 border-t border-white/5 pt-2">
                  {[
                    { color: 'bg-emerald-500/40', label: 'Clear' },
                    { color: 'bg-accent-amber/40', label: 'Alert' },
                    { color: 'bg-accent-red/40', label: 'Critical' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5 text-xs text-white/40">
                      <span className={`h-3 w-3 rounded ${item.color}`} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {priorityAlert && (
            <ResponderPanel
              alert={priorityAlert}
              room={priorityRoom}
              title="Suggested Responder"
            />
          )}
        </div>
      </div>
    </div>
  );
}
