export interface MediaLockState {
  audioLocked: boolean;
  videoLocked: boolean;
}

// Payload the client sends to toggle one lock; distinct from MediaLockState
// (the broadcast result), since only one target changes per call.
export interface SetMediaLockPayload {
  target: 'audio' | 'video';
  locked: boolean;
}

export const MEDIA_LOCK_EVENTS = {
  set: 'setMediaLock',
  state: 'mediaLockState',
} as const;
