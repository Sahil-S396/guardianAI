import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { callGeminiForAlert } from '../gemini';

const AUTO_ESCALATION_MS = 90_000;
const DUPLICATE_ALERT_COOLDOWN_MS = 2 * 60 * 1000;

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1_000_000);
  if (value instanceof Date) return value.getTime();
  return 0;
}

async function fetchNearbyStaff(hospitalId, floor) {
  if (!hospitalId) {
    return [];
  }

  try {
    const staffSnap = await getDocs(
      query(
        collection(db, `hospitals/${hospitalId}/staff`),
        where('floor', '==', floor),
        where('available', '==', true)
      )
    );

    return staffSnap.docs.map((staffDoc) => ({
      id: staffDoc.id,
      ...staffDoc.data(),
    }));
  } catch {
    return [];
  }
}

async function findExistingAlert({ hospitalId, roomId, alertType, sourceMonitorId }) {
  if (!hospitalId || !roomId || !alertType) {
    return null;
  }

  const filters = [
    where('roomId', '==', roomId),
    where('type', '==', alertType),
  ];

  if (sourceMonitorId) {
    filters.push(where('sourceMonitorId', '==', sourceMonitorId));
  }

  const snap = await getDocs(query(collection(db, `hospitals/${hospitalId}/alerts`), ...filters));
  const now = Date.now();

  return snap.docs
    .map((alertDoc) => ({ id: alertDoc.id, ...alertDoc.data() }))
    .find((alert) => {
      const isOpen = !alert.archivedAt && alert.status !== 'resolved';
      const createdAtMs = timestampToMs(alert.createdAt);
      const isFresh = createdAtMs > 0 && (now - createdAtMs) < DUPLICATE_ALERT_COOLDOWN_MS;
      return isOpen || isFresh;
    }) || null;
}

function scheduleAutoEscalation({ hospitalId, alertId, drillMode }) {
  if (!hospitalId || !alertId || drillMode) {
    return;
  }

  window.setTimeout(async () => {
    try {
      const alertRef = doc(db, `hospitals/${hospitalId}/alerts`, alertId);
      const alertSnap = await getDoc(alertRef);

      if (!alertSnap.exists()) {
        return;
      }

      const alert = alertSnap.data();
      if (alert.status === 'active') {
        await updateDoc(alertRef, {
          status: 'escalated',
          escalatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Auto-escalation failed:', error);
    }
  }, AUTO_ESCALATION_MS);
}

export async function createEmergencyAlert({
  hospitalId,
  room,
  alertType,
  drillMode = false,
  userId = null,
  source = 'manual',
  sourceMonitorId = null,
  cameraLabel = null,
  secondsSinceTrigger = 0,
  detectionSnapshot = null,
}) {
  if (!hospitalId) {
    throw new Error('Missing hospital context.');
  }

  if (!room?.id) {
    throw new Error('A room is required to create an alert.');
  }

  const existingAlert = await findExistingAlert({
    hospitalId,
    roomId: room.id,
    alertType,
    sourceMonitorId,
  });

  if (existingAlert) {
    return {
      alertId: existingAlert.id,
      duplicate: true,
      existingAlert,
    };
  }

  const nearbyStaff = await fetchNearbyStaff(hospitalId, room.floor);

  const alertPayload = {
    type: alertType,
    roomId: room.id,
    roomName: room.name,
    roomFloor: room.floor,
    roomZone: room.zone,
    roomMapNodeId: room.mapNodeId || null,
    hazardZoneId: room.mapNodeId || null,
    severity: alertType === 'fire' ? 'critical' : 'high',
    status: 'active',
    createdAt: serverTimestamp(),
    acknowledgedBy: null,
    acknowledgedAt: null,
    escalatedAt: null,
    geminiResponse: null,
    isDrill: drillMode,
    triggeredBy: userId,
    source,
    sourceMonitorId,
    cameraLabel,
    detectionSnapshot,
  };

  const alertRef = await addDoc(collection(db, `hospitals/${hospitalId}/alerts`), alertPayload);

  await updateDoc(doc(db, `hospitals/${hospitalId}/rooms`, room.id), {
    status: alertType === 'fire' ? 'critical' : 'alert',
  });

  callGeminiForAlert({
    roomName: room.name,
    zone: room.zone,
    floor: room.floor,
    alertType,
    nearbyStaff,
    secondsSinceTrigger,
    detectionSummary: detectionSnapshot?.summary || '',
    cameraLabel,
  })
    .then(async (geminiResponse) => {
      await updateDoc(doc(db, `hospitals/${hospitalId}/alerts`, alertRef.id), {
        geminiResponse,
        severity: geminiResponse.severity,
      });
    })
    .catch((error) => {
      console.error('Gemini alert enrichment failed:', error);
    });

  scheduleAutoEscalation({
    hospitalId,
    alertId: alertRef.id,
    drillMode,
  });

  return {
    alertId: alertRef.id,
    duplicate: false,
  };
}
