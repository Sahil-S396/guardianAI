const NON_ROOM_ZONE_TYPES = new Set([
  'exit_door',
  'entry_door',
  'aed_station',
  'fire_ext',
  'hazard',
  'camera',
]);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sortFloorLabels(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function formatZoneType(type) {
  return String(type || 'other')
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
        mapGeometry: {
          x: zone.x ?? 0,
          y: zone.y ?? 0,
          w: zone.w ?? 0,
          h: zone.h ?? 0,
          color: zone.color || '#888780',
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
