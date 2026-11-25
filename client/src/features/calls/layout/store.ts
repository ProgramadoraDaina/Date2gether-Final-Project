import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutZone } from './layout';

type ZoneChanges = Partial<Omit<LayoutZone, 'id'>>;

interface CallLayoutState {
  enabled: boolean;
  zones: LayoutZone[];
  setEnabled: (enabled: boolean) => void;
  addZone: () => void;
  updateZone: (id: string, changes: ZoneChanges) => void;
  removeZone: (id: string) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value) || min));

function sanitize(zone: LayoutZone): LayoutZone {
  return {
    ...zone,
    capacity: clamp(zone.capacity, 1, 50),
    width: clamp(zone.width, 10, 100),
    height: clamp(zone.height, 10, 100),
    tileSize: clamp(zone.tileSize, 60, 480),
  };
}

const SIDE_BY_SIDE = new Set(['left', 'right', 'beside-previous']);

// A full-size zone docked sideways would leave nothing for its neighbour.
function sizeForPlacement(zone: LayoutZone, changes: ZoneChanges): ZoneChanges {
  if (!changes.placement || changes.placement === zone.placement) return {};
  return SIDE_BY_SIDE.has(changes.placement)
    ? { width: 30, height: 100 }
    : { width: 100, height: 30 };
}

let created = 0;
const newZoneId = () => `zone-${Date.now().toString(36)}-${(created++).toString(36)}`;

function defaultZone(isFirst: boolean): LayoutZone {
  return isFirst
    ? {
        id: newZoneId(),
        capacity: 1,
        placement: 'bottom',
        width: 100,
        height: 100,
        tileSize: 480,
        aspect: '16:9',
      }
    : {
        id: newZoneId(),
        capacity: 4,
        placement: 'bottom',
        width: 100,
        height: 30,
        tileSize: 160,
        aspect: '16:9',
      };
}

export const useCallLayoutStore = create<CallLayoutState>()(
  persist(
    (set) => ({
      enabled: false,
      zones: [],
      setEnabled: (enabled) => set({ enabled }),
      addZone: () => set(({ zones }) => ({ zones: [...zones, defaultZone(zones.length === 0)] })),
      updateZone: (id, changes) =>
        set(({ zones }) => ({
          zones: zones.map((zone) =>
            zone.id === id
              ? sanitize({ ...zone, ...sizeForPlacement(zone, changes), ...changes })
              : zone,
          ),
        })),
      removeZone: (id) => set(({ zones }) => ({ zones: zones.filter((zone) => zone.id !== id) })),
    }),
    {
      name: 'date2gether:call-layout',
      version: 1,
      partialize: ({ enabled, zones }) => ({ enabled, zones }),
    },
  ),
);
