import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useHospital } from '../../contexts/HospitalContext';
import {
  isLocationRecent,
  pickSimulationDestination,
  buildTrackingGraphFromFloorMaps,
  SIMULATION_INTERVAL_MS,
  TRACKING_MODES,
} from '../../utils/staffTracker';

export default function StaffTrackingRuntime() {
  const { hospitalId, trackingMode } = useHospital();
  const [staff, setStaff] = useState([]);
  const [staffLocations, setStaffLocations] = useState([]);
  const [floorMaps, setFloorMaps] = useState([]);

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

  const graph = useMemo(() => buildTrackingGraphFromFloorMaps(floorMaps), [floorMaps]);

  useEffect(() => {
    if (!hospitalId || trackingMode !== TRACKING_MODES.SIMULATION || staff.length === 0 || graph.nodes.length === 0) {
      return undefined;
    }

    let disposed = false;

    const syncSimulationStep = async () => {
      if (disposed) {
        return;
      }

      const locationMap = new Map(staffLocations.map((location) => [location.staffId || location.id, location]));
      const batch = writeBatch(db);
      let pendingWrites = 0;

      staff.forEach((member, index) => {
        const currentLocation = locationMap.get(member.id);
        const hasFreshCheckIn = currentLocation && currentLocation.locationSource === 'checkin' && isLocationRecent(currentLocation);

        if (hasFreshCheckIn) {
          return;
        }

        const nextNode = pickSimulationDestination({
          currentZoneId: currentLocation?.zoneId || currentLocation?.mapNodeId || member.mapNodeId,
          floor: currentLocation?.floor ?? member.floor,
          graph,
          seedIndex: index + Math.floor(Date.now() / SIMULATION_INTERVAL_MS),
        });

        if (!nextNode) {
          return;
        }

        batch.set(
          doc(db, `hospitals/${hospitalId}/staffLocations`, member.id),
          {
            staffId: member.id,
            name: member.name || member.id,
            role: member.role || 'staff',
            floor: nextNode.floor,
            zone: nextNode.label,
            zoneId: nextNode.id,
            mapNodeId: nextNode.id,
            available: member.available ?? true,
            locationSource: 'simulation',
            timestamp: serverTimestamp(),
            lastCheckInAt: serverTimestamp(),
          },
          { merge: true }
        );

        batch.set(
          doc(db, `hospitals/${hospitalId}/staff`, member.id),
          {
            floor: nextNode.floor,
            zone: nextNode.label,
            zoneId: nextNode.id,
            mapNodeId: nextNode.id,
            available: member.available ?? true,
            locationSource: 'simulation',
            lastCheckInAt: serverTimestamp(),
          },
          { merge: true }
        );

        pendingWrites += 1;
      });

      if (pendingWrites > 0) {
        try {
          await batch.commit();
        } catch (error) {
          console.error('Simulation update failed:', error);
        }
      }
    };

    syncSimulationStep();
    const intervalId = window.setInterval(syncSimulationStep, SIMULATION_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [graph, hospitalId, staff, staffLocations, trackingMode]);

  return null;
}
