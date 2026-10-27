'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { RoleTag } from '@/features/rooms/RoleTag';
import { useRoomMembers } from '@/features/rooms/useRoomMembers';
import { ApiError, requestRoomAccess, type RoomAccess } from '@/lib/api';
import { CallControls } from '@/features/calls/CallControls';
import { useCallSession } from '@/features/calls/useCallSession';
import { createRoomSocket } from '@/lib/socket';
import { useTranslation } from '@/features/translation/useTranslation';

const MeetingRoom = dynamic(() => import('@/features/calls/MeetingRoom'), { ssr: false });

const NAME_KEY = 'date2gether:userName';

interface ChatMessage {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

type Notice = { text: string } | { event: 'joined' | 'left'; userName: string };

// Presencia en vivo del socket (no confundir con RoomMember de '@/lib/api',
// que es el registro de roles persistido en el backend).
interface RoomPresence {
  participantId: string;
  userName: string;
  userId?: string;
}

export default function RoomPage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [users, setUsers] = useState<RoomPresence[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const callSession = useCallSession();
  const {
    members,
    isCurrentUserAdmin,
    error: membersError,
    changeRole,
    refetchMembers,
  } = useRoomMembers(access ? code : undefined);

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY) ?? '');
  }, []);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const roomAccess = await requestRoomAccess(code, name.trim());
      localStorage.setItem(NAME_KEY, roomAccess.participant.name);
      setAccess(roomAccess);
    } catch (error) {
      setJoinError(error instanceof ApiError ? error.message : t('No se pudo entrar a la sala'));
    } finally {
      setJoining(false);
    }
  }

  useEffect(() => {
    if (!code || !access) return;
    const socket = createRoomSocket(access.token);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinRoom', { code });
    });

    socket.on('error', ({ message }: { message: string }) => {
      setNotice({ text: message });
    });
    socket.on('exception', ({ message }: { message: string }) => setNotice({ text: message }));
    socket.on('connect_error', () => setNotice({ text: t('No se pudo conectar a la sala') }));

    socket.on('roomHistory', (history: ChatMessage[]) => setMessages(history));
    socket.on('roomUsers', (list: RoomPresence[]) => setUsers(list));

    socket.on('userJoined', (joined: RoomPresence) => {
      setUsers((prev) =>
        prev.some((u) => u.participantId === joined.participantId) ? prev : [...prev, joined],
      );
      setNotice({ event: 'joined', userName: joined.userName });
    });

    socket.on('userLeft', (left: RoomPresence) => {
      setUsers((prev) => prev.filter((u) => u.participantId !== left.participantId));
      setNotice({ event: 'left', userName: left.userName });
    });

    socket.on('newMessage', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    // El REST de roles (useRoomMembers) no tiene su propio socket: cuando
    // un admin cambia un rol, el backend avisa por este evento y acá se
    // dispara el refetch para que se vea sin recargar la página.
    socket.on('memberRoleChanged', () => {
      refetchMembers();
    });

    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, access, refetchMembers, t]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    socketRef.current?.emit('sendMessage', { content: draft.trim() });
    setDraft('');
  }

  if (!access) {
    return (
      <div className="card">
        <h1>{t('Entrar a la reunión')}</h1>
        <p className="code">{code}</p>
        <p>{t('Elegí cómo querés aparecer. No necesitás una cuenta.')}</p>
        <form onSubmit={handleJoin}>
          <label htmlFor="guest-name">{t('Tu nombre en la reunión')}</label>
          <input
            id="guest-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            autoComplete="nickname"
          />
          <button type="submit" disabled={joining || !name.trim()}>
            {joining ? t('Entrando…') : t('Entrar a la reunión')}
          </button>
        </form>
        {joinError && (
          <p className="error" role="alert">
            {joinError}
          </p>
        )}
        <Link href="/">{t('Volver al inicio')}</Link>
      </div>
    );
  }

  return (
    <div className="room-layout">
      <div className="room-header">
        <div>
          <strong>Date2gether</strong> <span className="code">{code}</span>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
            } catch {
              setNotice({ text: t('No se pudo copiar el enlace') });
            }
          }}
        >
          {t(copied ? 'Enlace copiado' : 'Copiar enlace')}
        </button>
        <CallControls roomCode={code} roomToken={access.token} session={callSession} />
        <Link href="/">{t('Salir')}</Link>
      </div>

      {notice && (
        <div className="notice">
          {'text' in notice
            ? notice.text
            : `${notice.userName} ${t(notice.event === 'joined' ? 'se unió a la sala' : 'salió de la sala')}`}
        </div>
      )}
      {membersError && (
        <p className="error" role="alert">
          {membersError}
        </p>
      )}

      <div className="room-body">
        <div className="users-panel">
          <h3>
            {t('En la sala')} ({users.length})
          </h3>
          <ul>
            {users.map(({ participantId, userName, userId }) => {
              // Se cruza por userId (único), no por nombre: dos personas
              // pueden escribir el mismo userName y antes eso mezclaba sus
              // roles y botones de permisos.
              const member = userId ? members.find((m) => m.userId === userId) : undefined;
              const canChangeRole = isCurrentUserAdmin && member && member.role !== 'administrador';
              return (
                <li key={participantId}>
                  {userName}
                  {!userId && <span> ({t('Invitado')})</span>}
                  {member && <RoleTag role={member.role} />}
                  {canChangeRole && (
                    <button
                      type="button"
                      className="role-button"
                      onClick={() =>
                        changeRole(
                          member.userId,
                          member.role === 'participante' ? 'colaborador' : 'participante',
                        )
                      }
                    >
                      {member.role === 'participante'
                        ? t('Hacer colaborador')
                        : t('Quitar colaborador')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="meeting-and-chat">
          {callSession.session && <MeetingRoom call={callSession} />}
          <div className="chat-panel">
            <ul id="messages" ref={listRef}>
              {messages.map((m) => (
                <li key={m.id} className="message">
                  <span className="author">{m.authorName}</span>
                  {m.content}
                </li>
              ))}
            </ul>
            <form id="message-form" onSubmit={handleSend}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('Escribí un mensaje...')}
                autoComplete="off"
              />
              <button type="submit">{t('Enviar')}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
