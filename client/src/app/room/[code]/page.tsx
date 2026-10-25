'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { CallControls } from '@/features/calls/CallControls';
import { useCallSession } from '@/features/calls/useCallSession';
import { isLoggedIn } from '@/lib/auth';
import { createRoomSocket } from '@/lib/socket';

const NAME_KEY = 'date2gether:userName';

interface ChatMessage {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [users, setUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const callSession = useCallSession();

  useEffect(() => {
    if (!code) return;
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }

    const userName = localStorage.getItem(NAME_KEY) || 'Invitado';
    const socket = createRoomSocket();
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinRoom', { code, userName });
    });

    socket.on('error', ({ message }: { message: string }) => {
      setNotice(message);
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => router.push('/'), 2000);
    });

    socket.on('roomHistory', (history: ChatMessage[]) => setMessages(history));
    socket.on('roomUsers', (list: string[]) => setUsers(list));

    socket.on('userJoined', ({ userName: joined }: { userName: string }) => {
      setUsers((prev) => (prev.includes(joined) ? prev : [...prev, joined]));
      setNotice(`${joined} se unió a la sala`);
    });

    socket.on('userLeft', ({ userName: left }: { userName: string }) => {
      setUsers((prev) => prev.filter((u) => u !== left));
      setNotice(`${left} salió de la sala`);
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

  useEffect(() => {
    const meetingSession = callSession.meetingSession;
    if (!meetingSession || !audioRef.current) return;

    meetingSession.audioVideo.bindAudioElement(audioRef.current);
    return () => {
      meetingSession.audioVideo.unbindAudioElement();
    };
  }, [callSession.meetingSession]);

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
        <CallControls roomCode={code} session={callSession} />
        <Link href="/">Salir</Link>
      </div>

      <audio ref={audioRef} autoPlay hidden />

      {notice && <div className="notice">{notice}</div>}

      <div className="room-body">
        <div className="users-panel">
          <h3>En la sala ({users.length})</h3>
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
