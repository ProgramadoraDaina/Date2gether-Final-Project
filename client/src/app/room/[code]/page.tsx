'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { RoleTag } from '@/features/rooms/RoleTag';
import { useRoomMembers } from '@/features/rooms/useRoomMembers';
import { getCurrentUser } from '@/lib/auth';
import { createRoomSocket } from '@/lib/socket';

const NAME_KEY = 'date2gether:userName';

interface ChatMessage {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

// Presencia en vivo del socket (no confundir con RoomMember de '@/lib/api',
// que es el registro de roles persistido en el backend).
interface RoomPresence {
  userName: string;
  userId?: string;
}

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [users, setUsers] = useState<RoomPresence[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { members, isCurrentUserAdmin, error: membersError, changeRole, refetchMembers } =
    useRoomMembers(code);

  useEffect(() => {
    if (!code) return;

    const userName = localStorage.getItem(NAME_KEY) || 'Invitado';
    const socket = createRoomSocket();
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    socketRef.current = socket;

    socket.on('connect', () => {
      // Si hay sesión, viaja el userId real: así la UI puede cruzar esta
      // lista de presencia con los roles de la sala sin ambigüedad cuando
      // dos personas comparten el mismo userName.
      getCurrentUser().then((user) => {
        socket.emit('joinRoom', { code, userName, userId: user?.id });
      });
    });

    socket.on('error', ({ message }: { message: string }) => {
      setNotice(message);
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => router.push('/'), 2000);
    });

    socket.on('roomHistory', (history: ChatMessage[]) => setMessages(history));
    socket.on('roomUsers', (list: RoomPresence[]) => setUsers(list));

    socket.on('userJoined', (joined: RoomPresence) => {
      setUsers((prev) =>
        prev.some((u) => u.userName === joined.userName && u.userId === joined.userId)
          ? prev
          : [...prev, joined],
      );
      setNotice(`${joined.userName} se unió a la sala`);
    });

    socket.on('userLeft', (left: RoomPresence) => {
      setUsers((prev) =>
        prev.filter((u) => !(u.userName === left.userName && u.userId === left.userId)),
      );
      setNotice(`${left.userName} salió de la sala`);
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
      clearTimeout(redirectTimer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, router, refetchMembers]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    socketRef.current?.emit('sendMessage', { content: draft.trim() });
    setDraft('');
  }

  return (
    <div className="room-layout">
      <div className="room-header">
        <div>
          <strong>Date2gether</strong> <span className="code">{code}</span>
        </div>
        <Link href="/">Salir</Link>
      </div>

      {notice && <div className="notice">{notice}</div>}
      {membersError && (
        <p className="error" role="alert">
          {membersError}
        </p>
      )}

      <div className="room-body">
        <div className="users-panel">
          <h3>En la sala ({users.length})</h3>
          <ul>
            {users.map(({ userName, userId }, index) => {
              // Se cruza por userId (único), no por nombre: dos personas
              // pueden escribir el mismo userName y antes eso mezclaba sus
              // roles y botones de permisos.
              const member = userId ? members.find((m) => m.userId === userId) : undefined;
              const canChangeRole = isCurrentUserAdmin && member && member.role !== 'administrador';
              return (
                <li key={userId ?? `${userName}-${index}`}>
                  {userName}
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
                      {member.role === 'participante' ? 'Hacer colaborador' : 'Quitar colaborador'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

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
              placeholder="Escribí un mensaje..."
              autoComplete="off"
            />
            <button type="submit">Enviar</button>
          </form>
        </div>
      </div>
    </div>
  );
}
