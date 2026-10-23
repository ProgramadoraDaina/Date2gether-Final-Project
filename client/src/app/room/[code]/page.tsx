'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { createRoomSocket } from '@/lib/socket';
import { useTranslation } from '@/features/translation/useTranslation';

const NAME_KEY = 'date2gether:userName';

interface ChatMessage {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

type Notice = { text: string } | { event: 'joined' | 'left'; userName: string };

export default function RoomPage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [users, setUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!code) return;

    const userName = localStorage.getItem(NAME_KEY) || 'Invitado';
    const socket = createRoomSocket();
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinRoom', { code, userName });
    });

    socket.on('error', ({ message }: { message: string }) => {
      setNotice({ text: message });
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => router.push('/'), 2000);
    });

    socket.on('roomHistory', (history: ChatMessage[]) => setMessages(history));
    socket.on('roomUsers', (list: string[]) => setUsers(list));

    socket.on('userJoined', ({ userName: joined }: { userName: string }) => {
      setUsers((prev) => (prev.includes(joined) ? prev : [...prev, joined]));
      setNotice({ event: 'joined', userName: joined });
    });

    socket.on('userLeft', ({ userName: left }: { userName: string }) => {
      setUsers((prev) => prev.filter((u) => u !== left));
      setNotice({ event: 'left', userName: left });
    });

    socket.on('newMessage', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.connect();

    return () => {
      clearTimeout(redirectTimer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, router]);

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
        <Link href="/">{t('Salir')}</Link>
      </div>

      {notice && (
        <div className="notice">
          {'text' in notice
            ? notice.text
            : `${notice.userName} ${t(notice.event === 'joined' ? 'se unió a la sala' : 'salió de la sala')}`}
        </div>
      )}

      <div className="room-body">
        <div className="users-panel">
          <h3>
            {t('En la sala')} ({users.length})
          </h3>
          <ul>
            {users.map((u) => (
              <li key={u}>{u}</li>
            ))}
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
              placeholder={t('Escribí un mensaje...')}
              autoComplete="off"
            />
            <button type="submit">{t('Enviar')}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
