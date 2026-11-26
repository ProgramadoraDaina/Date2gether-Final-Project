'use client';

import { useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import type { Socket } from 'socket.io-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  decodeHand,
  encodeHand,
  handQueue,
  HANDS_TOPIC,
  type HandMessage,
  type RaisedHand,
} from './hands';
import { avatarIdentityOf } from '@/features/avatar/TileAvatar';

interface HandsContextValue {
  own: string;
  queue: RaisedHand[];
  raised: boolean;
  toggle: () => void;
  lower: (identity: string) => void;
}

const HandsContext = createContext<HandsContextValue>({
  own: '',
  queue: [],
  raised: false,
  toggle: () => {},
  lower: () => {},
});

export const useHands = () => useContext(HandsContext);

export function HandsProvider({
  children,
  socket = null,
}: {
  children: ReactNode;
  // Socket de la sala: el servidor valida que quien baja la mano de otro sea admin.
  socket?: Socket | null;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [hands, setHands] = useState<Record<string, RaisedHand>>({});
  const own = localParticipant.identity;
  const ownHand = hands[own];
  const ownHandRef = useRef(ownHand);
  ownHandRef.current = ownHand;

  const setHand = useCallback((identity: string, hand: RaisedHand | null) => {
    setHands((previous) => {
      if (!hand && !previous[identity]) return previous;
      const next = { ...previous };
      if (hand) next[identity] = hand;
      else delete next[identity];
      return next;
    });
  }, []);

  const { send } = useDataChannel(HANDS_TOPIC, (msg) => {
    const message = decodeHand(msg.payload);
    const from = msg.from;
    if (!message || !from) return;
    if (message.raised) {
      setHand(from.identity, {
        identity: from.identity,
        source: avatarIdentityOf(from),
        name: from.name || from.identity,
        at: message.at,
      });
    } else if (!message.target) {
      setHand(from.identity, null);
    }
  });

  const broadcast = useCallback(
    (message: HandMessage, to?: string[]) =>
      void send(encodeHand(message), {
        reliable: true,
        topic: HANDS_TOPIC,
        destinationIdentities: to,
      }),
    [send],
  );

  // Quien entra tarde no vio el mensaje original: cada mano levantada se le reenvía.
  useEffect(() => {
    const resend = (participant: RemoteParticipant) => {
      const hand = ownHandRef.current;
      if (hand) broadcast({ raised: true, at: hand.at }, [participant.identity]);
    };
    const forget = (participant: RemoteParticipant) => setHand(participant.identity, null);
    room.on(RoomEvent.ParticipantConnected, resend);
    room.on(RoomEvent.ParticipantDisconnected, forget);
    return () => {
      room.off(RoomEvent.ParticipantConnected, resend);
      room.off(RoomEvent.ParticipantDisconnected, forget);
    };
  }, [room, broadcast, setHand]);

  const toggle = useCallback(() => {
    if (ownHandRef.current) {
      setHand(own, null);
      broadcast({ raised: false });
      return;
    }
    const at = Date.now();
    setHand(own, {
      identity: own,
      source: avatarIdentityOf(localParticipant),
      name: localParticipant.name || own,
      at,
    });
    broadcast({ raised: true, at });
  }, [own, localParticipant.name, broadcast, setHand]);

  const lower = useCallback(
    (identity: string) => {
      if (identity === own) {
        if (ownHandRef.current) toggle();
        return;
      }
      const hand = hands[identity];
      if (!hand) return;
      setHand(identity, null);
      socket?.emit('lowerHand', { participantId: hand.source });
    },
    [own, toggle, hands, socket, setHand],
  );

  // El servidor solo manda este aviso si lo pidió un admin.
  useEffect(() => {
    if (!socket) return;
    const lowered = () => {
      if (ownHandRef.current) toggle();
    };
    socket.on('lowerHand', lowered);
    return () => {
      socket.off('lowerHand', lowered);
    };
  }, [socket, toggle]);

  const value = useMemo(
    () => ({ own, queue: handQueue(hands), raised: !!ownHand, toggle, lower }),
    [own, hands, ownHand, toggle, lower],
  );
  return <HandsContext.Provider value={value}>{children}</HandsContext.Provider>;
}
