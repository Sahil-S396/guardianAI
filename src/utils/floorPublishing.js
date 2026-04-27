const NON_ROOM_ZONE_TYPES = new Set([
  'exit_door',
  'entry_door',
  'aed_station',
  'fire_ext',
  'hazard',
  'camera',
]);

const ZONE_TYPE_LABELS = {
  icu: 'Intensive Rehab',
  emergency: 'Rapid Response',
  ward: 'Guest Suite',
  surgery: 'Therapy Suite',
  corridor: 'Corridor',
  reception: 'Front Desk',
  lab: 'Assessment Room',
  pharmacy: 'Med Storage',
  stairwell: 'Stairwell',
  exit_door: 'Exit Door',
  entry_door: 'Entry Door',
  aed_station: 'AED Station',
  fire_ext: 'Fire Extinguisher',
  hazard: 'Hazard Point',
  elevator: 'Elevator',
  camera: 'Camera',
  other: 'Other',
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildMapZoneNodeId(floorNumber, zone, index) {
  const floor = String(floorNumber ?? '').trim() || '0';
  const type = String(zone?.type || 'other')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const label = slugify(zone?.label || type || 'zone') || 'zone';

  return `F${floor}_${String(index + 1).padStart(2, '0')}_${type}_${label}`;
}

export function sortFloorLabels(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function formatZoneType(type) {
  const normalized = String(type || 'other').trim();
  const lookupKey = normalized.toLowerCase().replace(/[\s-]+/g, '_');
  if (ZONE_TYPE_LABELS[lookupKey]) {
    return ZONE_TYPE_LABELS[lookupKey];
  }

  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildSystemRoomsFromFloor(floorNumber, floorData) {
  const floor = String(floorNumber);
  const zones = Array.isArray(floorData?.zones) ? floorData.zones : [];

  return zones
    .filter((zone) => zone?.label?.trim() && !NON_ROOM_ZONE_TYPES.has(zone.type))
    .map((zone, index) => {
      const name = zone.label.trim();
      const mappedType = formatZoneType(zone.type);
      const numericLabel = name.replace(/[^0-9]/g, '');
      const shortLabel = numericLabel || name.slice(0, 10);
      const mapNodeId = buildMapZoneNodeId(floor, zone, index);

      return {
        id: `map-floor-${floor}-${String(index + 1).padStart(2, '0')}-${slugify(name) || 'zone'}`,
        name,
        shortLabel,
        zone: mappedType,
        floor,
        type: mappedType,
        status: 'clear',
        source: 'map-editor',
        mapZoneType: zone.type || 'other',
        mapNodeId,
        mapGeometry: {
          x: zone.x ?? 0,
          y: zone.y ?? 0,
          w: zone.w ?? 0,
          h: zone.h ?? 0,
          color: zone.color || '#888780',
          nodeId: mapNodeId,
        },
        sortOrder: index,
      };
    });
}

export function getFloorTileLabel(room) {
  const label = String(room?.shortLabel || room?.name || room?.id || '').trim();
  if (!label) return '---';

  const numeric = label.replace(/[^0-9]/g, '');
  if (numeric) return numeric;

  return label.length > 10 ? `${label.slice(0, 9)}...` : label;
}
