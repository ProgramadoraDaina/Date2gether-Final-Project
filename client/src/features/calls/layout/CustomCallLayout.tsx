'use client';

import { useMemo } from 'react';
import { TrackRefContext, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { ReactionTile } from '../reactions/ReactionTile';
import { assignToZones, buildLayoutTree, type LayoutZone } from './layout';
import { LayoutView } from './LayoutView';
import styles from './CallLayout.module.css';

interface CustomCallLayoutProps {
  tracks: TrackReferenceOrPlaceholder[];
  zones: LayoutZone[];
}

const trackKey = (track: TrackReferenceOrPlaceholder) =>
  `${track.participant.identity}-${track.source}`;

export function CustomCallLayout({ tracks, zones }: CustomCallLayoutProps) {
  const tree = useMemo(() => buildLayoutTree(zones), [zones]);
  const groups = useMemo(() => {
    const ordered = [
      ...tracks.filter((track) => track.source === 'screen_share'),
      ...tracks.filter((track) => track.source !== 'screen_share'),
    ];
    const assigned = assignToZones(zones, ordered);
    return new Map(zones.map((zone, index) => [zone.id, assigned[index]]));
  }, [tracks, zones]);

  if (!tree) return null;
  return (
    <div className={styles.stage}>
      <LayoutView
        tree={tree}
        renderZone={(zone) =>
          groups.get(zone.id)?.map((track) => (
            <div
              key={trackKey(track)}
              className={styles.tile}
              style={{ width: zone.tileSize, aspectRatio: zone.aspect.replace(':', ' / ') }}
              data-testid="layout-tile"
            >
              <TrackRefContext.Provider value={track}>
                <ReactionTile canFocus={tracks.length > 1} />
              </TrackRefContext.Provider>
            </div>
          ))
        }
      />
    </div>
  );
}
