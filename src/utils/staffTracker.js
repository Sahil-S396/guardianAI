const CIRCULATION_TYPES = new Set([
  'corridor',
  'stairwell',
  'elevator',
  'entry_door',
  'exit_door',
]);

const TRACKABLE_EXCLUDED_TYPES = new Set(['camera']);

export const TRACKING_MODES = {
  LIVE: 'live',
  SIMULATION: 'simulation',
};

export const AUTO_ESCALATION_MS = 90_000;
export const STAFF_STALE_MS = 2 * 60 * 1000;
export const SIMULATION_INTERVAL_MS = 30_000;
export const STAFF_LOCATION_STORAGE_KEY = 'guardianai.staffLocations';

export const DEMO_STAFF = [
  { id: 'nurse-priya', name: 'Nurse Priya', role: 'nurse', available: true },
  { id: 'guard-rajan', name: 'Guard Rajan', role: 'security', available: true },
  { id: 'dr-mehta', name: 'Dr. Mehta', role: 'admin', available: true },
  { id: 'nurse-aisha', name: 'Nurse Aisha', role: 'nurse', available: true },
  { id: 'guard-neel', name: 'Guard Neel', role: 'security', available: true },
  { id: 'nurse-kavya', name: 'Nurse Kavya', role: 'nurse', available: true },
];

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeZoneType(value) {
  return String(value || 'other')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeFloor(value) {
  return String(value ?? '').trim() || '0';
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function calculateCenter(node) {
  return {
    cx: asNumber(node.x) + asNumber(node.w) / 2,
    cy: asNumber(node.y) + asNumber(node.h) / 2,
  };
}

function calculateGap(a, b) {
  const ax2 = asNumber(a.x) + asNumber(a.w);
  const ay2 = asNumber(a.y) + asNumber(a.h);
  const bx2 = asNumber(b.x) + asNumber(b.w);
  const by2 = asNumber(b.y) + asNumber(b.h);

  const dx = Math.max(0, Math.max(asNumber(a.x) - bx2, asNumber(b.x) - ax2));
  const dy = Math.max(0, Math.max(asNumber(a.y) - by2, asNumber(b.y) - ay2));

  return Math.hypot(dx, dy);
}

function calculateCenterDistance(a, b) {
  const { cx: ax, cy: ay } = calculateCenter(a);
  const { cx: bx, cy: by } = calculateCenter(b);
  return Math.hypot(ax - bx, ay - by);
}

function estimateEdgeWeight(a, b) {
  const gap = calculateGap(a, b);
  const centerDistance = calculateCenterDistance(a, b);
  return Math.max(1, Math.round((gap * 0.7) + (centerDistance * 0.3)));
}

function shouldDirectlyConnect(a, b) {
  const gap = calculateGap(a, b);
  const centerDistance = calculateCenterDistance(a, b);
  const eitherCirculation = a.isCirculation || b.isCirculation;
  const sameType = a.type === b.type;
  const threshold = eitherCirculation ? 90 : 48;

  if (gap <= threshold) {
    return true;
  }

  return sameType && centerDistance <= 140;
}

function addEdge(adjacency, sourceId, targetId, weight) {
  if (!adjacency.has(sourceId)) {
    adjacency.set(sourceId, []);
  }

  const existing = adjacency.get(sourceId).find((entry) => entry.to === targetId);
  if (existing) {
    existing.weight = Math.min(existing.weight, weight);
    return;
  }

  adjacency.get(sourceId).push({ to: targetId, weight });
}

function upsertUndirectedEdge(adjacency, a, b, weight) {
  addEdge(adjacency, a, b, weight);
  addEdge(adjacency, b, a, weight);
}

function buildNodeFromZone(floorNumber, zone, index) {
  const floor = normalizeFloor(floorNumber);
  const label = String(zone?.label || zone?.type || `Zone ${index + 1}`).trim();
  const type = normalizeZoneType(zone?.type);
  const color = zone?.color || '#888780';
  const id = zone?.nodeId || `F${floor}_${String(index + 1).padStart(2, '0')}_${slugify(type)}_${slugify(label) || 'zone'}`;
  const geometry = {
    id,
    floor,
    label,
    type,
    color,
    x: asNumber(zone?.x),
    y: asNumber(zone?.y),
    w: Math.max(10, asNumber(zone?.w, 20)),
    h: Math.max(10, asNumber(zone?.h, 20)),
  };

  const center = calculateCenter(geometry);

  return {
    ...geometry,
    ...center,
    isCirculation: CIRCULATION_TYPES.has(type),
  };
}

function buildNodesForFloor(floorNumber, floorData) {
  const zones = Array.isArray(floorData?.zones) ? floorData.zones : [];
  return zones
    .filter((zone) => zone && !TRACKABLE_EXCLUDED_TYPES.has(normalizeZoneType(zone.type)))
    .map((zone, index) => buildNodeFromZone(floorNumber, zone, index));
}

function buildAdjacency(nodes) {
  const adjacency = new Map();
  const byFloor = new Map();

  nodes.forEach((node) => {
    if (!byFloor.has(node.floor)) {
      byFloor.set(node.floor, []);
    }
    byFloor.get(node.floor).push(node);
    if (!adjacency.has(node.id)) {
      adjacency.set(node.id, []);
    }
  });

  byFloor.forEach((floorNodes) => {
    for (let index = 0; index < floorNodes.length; index += 1) {
      for (let next = index + 1; next < floorNodes.length; next += 1) {
        const current = floorNodes[index];
        const candidate = floorNodes[next];

        if (shouldDirectlyConnect(current, candidate)) {
          upsertUndirectedEdge(adjacency, current.id, candidate.id, estimateEdgeWeight(current, candidate));
        }
      }
    }

    const circulationNodes = floorNodes.filter((node) => node.isCirculation);

    floorNodes
      .filter((node) => !node.isCirculation)
      .forEach((node) => {
        const existing = adjacency.get(node.id) || [];
        if (existing.length > 0 || circulationNodes.length === 0) {
          return;
        }

        const nearest = [...circulationNodes]
          .sort((a, b) => calculateGap(node, a) - calculateGap(node, b))[0];

        if (nearest) {
          upsertUndirectedEdge(adjacency, node.id, nearest.id, estimateEdgeWeight(node, nearest));
        }
      });
  });

  const verticalNodes = nodes.filter((node) => node.type === 'stairwell' || node.type === 'elevator');

  verticalNodes.forEach((node) => {
    const peer = verticalNodes
      .filter((candidate) => candidate.id !== node.id && candidate.type === node.type)
      .sort((a, b) => calculateCenterDistance(node, a) - calculateCenterDistance(node, b))[0];

    if (!peer) {
      return;
    }

    const floorDelta = Math.abs(Number(peer.floor) - Number(node.floor));
    const centerDelta = calculateCenterDistance(node, peer);

    if ((Number.isFinite(floorDelta) && floorDelta <= 1) || centerDelta <= 120) {
      upsertUndirectedEdge(adjacency, node.id, peer.id, Math.max(50, Math.round(centerDelta || 60)));
    }
  });

  return adjacency;
}

export function buildTrackingGraphFromFloorMaps(floorMaps = []) {
  const nodes = floorMaps.flatMap((floorMap) => {
    const floorNumber = floorMap?.floor ?? floorMap?.floorNumber ?? 0;
    return buildNodesForFloor(floorNumber, floorMap);
  });

  const adjacency = buildAdjacency(nodes);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return { nodes, nodeMap, adjacency };
}

export function buildTrackingGraphFromExportedMap(payload = {}) {
  const floors = Array.isArray(payload?.floors) ? payload.floors : [];
  return buildTrackingGraphFromFloorMaps(floors);
}

export function resolveNodeFromRoom(room, graph) {
  if (!room || !graph?.nodes?.length) {
    return null;
  }

  if (room.mapNodeId && graph.nodeMap.has(room.mapNodeId)) {
    return graph.nodeMap.get(room.mapNodeId);
  }

  const floor = normalizeFloor(room.floor);
  const roomName = String(room.name || '').trim().toLowerCase();

  const sameFloorNodes = graph.nodes.filter((node) => node.floor === floor);
  const directLabelMatch = sameFloorNodes.find((node) => node.label.toLowerCase() === roomName);
  if (directLabelMatch) {
    return directLabelMatch;
  }

  const fuzzyLabelMatch = sameFloorNodes.find((node) => node.label.toLowerCase().includes(roomName) || roomName.includes(node.label.toLowerCase()));
  if (fuzzyLabelMatch) {
    return fuzzyLabelMatch;
  }

  return null;
}

function dijkstra(adjacency, startId) {
  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const visited = new Set();

  while (visited.size < adjacency.size) {
    let currentId = null;
    let currentDistance = Infinity;

    distances.forEach((distance, nodeId) => {
      if (!visited.has(nodeId) && distance < currentDistance) {
        currentId = nodeId;
        currentDistance = distance;
      }
    });

    if (!currentId) {
      break;
    }

    visited.add(currentId);
    const edges = adjacency.get(currentId) || [];

    edges.forEach(({ to, weight }) => {
      const nextDistance = currentDistance + weight;
      if (nextDistance < (distances.get(to) ?? Infinity)) {
        distances.set(to, nextDistance);
        previous.set(to, currentId);
      }
    });
  }

  return { distances, previous };
}

function countHops(previous, destinationId) {
  let hops = 0;
  let cursor = destinationId;

  while (previous.has(cursor)) {
    hops += 1;
    cursor = previous.get(cursor);
  }

  return hops;
}

function fallbackDistance(hazardNode, staffNode, hazardFloor, staffFloor) {
  if (hazardNode && staffNode) {
    return {
      distance: calculateCenterDistance(hazardNode, staffNode),
      hops: hazardFloor === staffFloor ? 1 : 2 + Math.abs(Number(hazardFloor) - Number(staffFloor)),
    };
  }

  const floorDelta = Math.abs(Number(hazardFloor) - Number(staffFloor));
  return {
    distance: floorDelta * 200,
    hops: floorDelta === 0 ? 2 : 2 + floorDelta,
  };
}

export function timestampToMs(value) {
  if (!value) {
    return 0;
  }

  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }

  if (typeof value?.seconds === 'number') {
    return (value.seconds * 1000) + Math.round((value.nanoseconds || 0) / 1_000_000);
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isLocationRecent(location, now = Date.now()) {
  const lastSeenAt = timestampToMs(location?.timestamp || location?.lastCheckInAt);
  return lastSeenAt > 0 && (now - lastSeenAt) <= STAFF_STALE_MS;
}

export function estimateResponseTime(hops, distance) {
  if (hops <= 0 || distance <= 15) {
    return 'On site';
  }
  if (hops <= 1) {
    return 'Under 1 min';
  }
  if (hops <= 3) {
    return '1-2 min';
  }
  if (hops <= 5) {
    return '3-5 min';
  }
  return '5+ min';
}

export function formatDistanceLabel(hops, distance) {
  if (hops <= 0 || distance <= 15) {
    return 'At scene';
  }
  if (hops === 1) {
    return '1 hop away';
  }
  return `${hops} hops away`;
}

function resolveStaffNode(staffMember, location, graph) {
  const nodeId = location?.zoneId || location?.mapNodeId || staffMember?.zoneId || staffMember?.mapNodeId;
  if (nodeId && graph.nodeMap.has(nodeId)) {
    return graph.nodeMap.get(nodeId);
  }

  const staffFloor = normalizeFloor(location?.floor ?? staffMember?.floor);
  const zoneName = String(location?.zone || staffMember?.zone || '').trim().toLowerCase();
  if (!zoneName) {
    return null;
  }

  return graph.nodes.find((node) => node.floor === staffFloor && node.label.toLowerCase() === zoneName) || null;
}

export function buildLocalLocationSnapshot(staffLocations = []) {
  return staffLocations.reduce((accumulator, location) => {
    accumulator[location.staffId || location.id] = location;
    return accumulator;
  }, {});
}

export function readLocalStaffLocations() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STAFF_LOCATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeLocalStaffLocation(staffId, payload) {
  if (typeof window === 'undefined' || !staffId) {
    return;
  }

  const existing = readLocalStaffLocations();
  existing[staffId] = payload;
  window.localStorage.setItem(STAFF_LOCATION_STORAGE_KEY, JSON.stringify(existing));
}

export function findNearestStaff({
  hazardZoneId,
  room,
  staff = [],
  staffLocations = [],
  floorMaps = [],
  now = Date.now(),
}) {
  const graph = buildTrackingGraphFromFloorMaps(floorMaps);
  const locationMap = new Map(
    staffLocations.map((location) => [location.staffId || location.id, location])
  );

  const hazardNode = (hazardZoneId && graph.nodeMap.get(hazardZoneId)) || resolveNodeFromRoom(room, graph);
  const hazardFloor = normalizeFloor(room?.floor ?? hazardNode?.floor);
  const ranked = staff
    .filter((member) => member?.available)
    .map((member) => {
      const liveLocation = locationMap.get(member.id);
      const sourceLocation = liveLocation || member;
      const staffNode = resolveStaffNode(member, sourceLocation, graph);
      let distance = Infinity;
      let hops = Infinity;

      if (hazardNode && staffNode && graph.adjacency.has(staffNode.id)) {
        const { distances, previous } = dijkstra(graph.adjacency, staffNode.id);
        const routeDistance = distances.get(hazardNode.id);
        if (Number.isFinite(routeDistance)) {
          distance = routeDistance;
          hops = countHops(previous, hazardNode.id);
        }
      }

      if (!Number.isFinite(distance) || !Number.isFinite(hops)) {
        const fallback = fallbackDistance(
          hazardNode,
          staffNode,
          hazardFloor,
          normalizeFloor(sourceLocation?.floor ?? member?.floor)
        );
        distance = fallback.distance;
        hops = fallback.hops;
      }

      return {
        ...member,
        zone: sourceLocation?.zone || member?.zone || staffNode?.label || 'Unknown',
        floor: normalizeFloor(sourceLocation?.floor ?? member?.floor ?? staffNode?.floor),
        zoneId: sourceLocation?.zoneId || sourceLocation?.mapNodeId || member?.zoneId || staffNode?.id || null,
        locationSource: sourceLocation?.locationSource || sourceLocation?.source || 'directory',
        lastSeenAt: timestampToMs(sourceLocation?.timestamp || sourceLocation?.lastCheckInAt),
        isRecent: isLocationRecent(sourceLocation, now),
        distance,
        hops,
        distanceLabel: formatDistanceLabel(hops, distance),
        estimatedResponseTime: estimateResponseTime(hops, distance),
      };
    })
    .sort((a, b) => {
      if (a.isRecent !== b.isRecent) {
        return a.isRecent ? -1 : 1;
      }
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  return {
    ranked,
    graph,
    hazardNode,
  };
}

export function pickSimulationDestination({ currentZoneId, floor, graph, seedIndex = 0 }) {
  if (!graph?.nodes?.length) {
    return null;
  }

  if (currentZoneId && graph.adjacency.has(currentZoneId)) {
    const neighbors = graph.adjacency.get(currentZoneId) || [];
    if (neighbors.length > 0) {
      const choice = neighbors[seedIndex % neighbors.length];
      return graph.nodeMap.get(choice.to) || null;
    }
  }

  const sameFloorNodes = graph.nodes.filter((node) => node.floor === normalizeFloor(floor));
  if (sameFloorNodes.length > 0) {
    return sameFloorNodes[seedIndex % sameFloorNodes.length];
  }

  return graph.nodes[seedIndex % graph.nodes.length] || null;
}

export function getEscalationRemainingMs(alert, now = Date.now()) {
  const alertTime = timestampToMs(alert?.createdAt);
  if (!alertTime) {
    return AUTO_ESCALATION_MS;
  }

  return Math.max(0, AUTO_ESCALATION_MS - (now - alertTime));
}
