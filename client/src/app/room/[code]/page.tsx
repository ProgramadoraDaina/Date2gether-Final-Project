'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { EmojiPickerButton } from '@/features/chat/EmojiPickerButton';
import { AppShell } from '@/features/navigation/AppShell';
import { RoleTag } from '@/features/rooms/RoleTag';
import roleTagStyles from '@/features/rooms/RoleTag.module.css';
import { RoomSidebar } from '@/features/rooms/RoomSidebar';
import { useResizablePanel } from '@/features/rooms/useResizablePanel';
import { useRoomMembers } from '@/features/rooms/useRoomMembers';
import { ApiError, requestRoomAccess, type RoomAccess } from '@/lib/api';
import { useCallSession } from '@/features/calls/useCallSession';
import { createRoomSocket } from '@/lib/socket';
import { useTranslation } from '@/features/translation/useTranslation';
import { NAME_COLOR_HEX, isNameColorId } from '@/lib/nameColors';
import styles from './page.module.css';

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
  // Solo cuentas que eligieron un color en /settings; ausente/null en invitados.
  nameColor?: string | null;
}

// El id ya viene validado por el backend (uno de los 8 de NAME_COLOR_HEX),
// pero se revalida acá antes de indexar para no romper si llega otro valor.
function nameColorHex(nameColor?: string | null): string | undefined {
  if (!nameColor || !isNameColorId(nameColor)) return undefined;
  return NAME_COLOR_HEX[nameColor];
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
  const [chatTab, setChatTab] = useState<'chat' | 'presentes'>('chat');
  const [chatOpen, setChatOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarResize = useResizablePanel({
    storageKey: 'date2gether:sidebarWidth',
    defaultWidth: 220,
    min: 180,
    max: 400,
    edge: 'left',
  });
  const chatResize = useResizablePanel({
    storageKey: 'date2gether:chatWidth',
    defaultWidth: 340,
    min: 260,
    max: 520,
    edge: 'right',
  });
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);
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

  // Al estilo Google Meet: entrar a la sala ya significa estar en la llamada,
  // sin un paso manual de "Llamar". Si el usuario corta manualmente, este
  // efecto no debe reconectar: `access`/`code` no cambian después de un
  // hangup, así que no se vuelve a disparar. `callSession` se omite a
  // propósito de las dependencias: es estable (useCallback sin deps) y
  // agregarla no cambia el comportamiento, solo confunde la intención.
  // (oxlint no soporta suprimir esta regla con un comentario inline; el
  // warning "missing dependency: callSession" que queda es esperado.)
  useEffect(() => {
    if (!access) return;
    callSession.joinCall(code, access.token);
  }, [access, code]);

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

  function handleEmojiSelect(emoji: string) {
    const input = draftInputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    // El cursor se reubica después del re-render, cuando el value ya cambió.
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setNotice({ text: t('No se pudo copiar el enlace') });
    }
  }

  // Misma tarjeta para el estado "todavía sin acceso" y para el de "acceso
  // concedido pero la llamada no está in-call": en este segundo caso se
  // muestra como overlay de pantalla completa ARRIBA de la sala (ver el
  // return final), no en vez de ella. La sala y <MeetingRoom> tienen que
  // montarse ya (aunque quede tapada) porque es justamente ese montaje el
  // que dispara la conexión a LiveKit y, con ella, el status 'in-call' que
  // hace desaparecer este overlay. Si se la reemplaza en vez de tapar, el
  // status nunca avanza de 'connecting' (no hay nada que la saque de ahí).
  const joinCard = (
    <div className={styles.card}>
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
        <p className={styles.error} role="alert">
          {joinError}
        </p>
      )}
      <Link href="/">{t('Volver al inicio')}</Link>
    </div>
  );

  if (!access) {
    return <AppShell>{joinCard}</AppShell>;
  }

  const callOverlay = callSession.status !== 'in-call' && (
    <div className={styles.joinOverlayScreen}>
      <div className={styles.joinScreen}>
        {joinCard}
        <div className={styles.callLoadingOverlay} role="status" aria-live="polite">
          {callSession.status === 'error' ? (
            <>
              <p>{callSession.error ? t(callSession.error) : t('No se pudo conectar a la llamada')}</p>
              <button
                type="button"
                className={styles.callLoadingButton}
                onClick={() => callSession.joinCall(code, access.token)}
              >
                {t('Reintentar')}
              </button>
              <Link href="/" className={styles.callLoadingLink}>
                {t('Volver al inicio')}
              </Link>
            </>
          ) : (
            <>
              <div className={styles.callLoadingSpinner} />
              <p>{t('Cargando llamada…')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // Contenido del panel de chat (tabs + lista de mensajes o de presentes):
  // se calcula una sola vez y se monta dentro de dos envoltorios distintos
  // más abajo, según haya o no una llamada activa (ver comentario junto a
  // chatPanelInCallWrap). Evita duplicar este bloque dos veces en el JSX.
  const chatContent = (
    <>
      <div className={styles.chatTabs}>
        <button
          type="button"
          className={`${styles.chatTab} ${chatTab === 'chat' ? styles.chatTabActive : ''}`}
          onClick={() => setChatTab('chat')}
        >
          {t('Conversación')}
        </button>
        <button
          type="button"
          className={`${styles.chatTab} ${chatTab === 'presentes' ? styles.chatTabActive : ''}`}
          onClick={() => setChatTab('presentes')}
        >
          {t('Presentes')}
        </button>
      </div>
      {chatTab === 'chat' ? (
        <>
          <ul className={styles.messages} ref={listRef}>
            {messages.map((m) => {
              // No hay un id de autor persistido por mensaje: el color se
              // resuelve cruzando por nombre contra la presencia actual.
              // Es una simplificación aceptada para v1 (ver comentario en
              // el PR): un mensaje viejo de alguien que ya se fue, o una
              // colisión de nombres entre dos personas distintas, puede
              // quedar sin color o con el color equivocado.
              const presence = users.find((u) => u.userName === m.authorName);
              const color = nameColorHex(presence?.nameColor);
              return (
                <li key={m.id} className={styles.message}>
                  <span className={styles.author} style={color ? { color } : undefined}>
                    {m.authorName}
                  </span>
                  {m.content}
                </li>
              );
            })}
          </ul>
          <form className={styles.messageForm} onSubmit={handleSend}>
            <EmojiPickerButton onSelect={handleEmojiSelect} />
            <input
              ref={draftInputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('Escribí un mensaje...')}
              autoComplete="off"
            />
            <button type="submit">{t('Enviar')}</button>
          </form>
        </>
      ) : (
        <div className={styles.usersPanel}>
          <h3>
            {t('En la sala')} ({users.length})
          </h3>
          <ul>
            {users.map(({ participantId, userName, userId, nameColor }) => {
              // Se cruza por userId (único), no por nombre: dos personas
              // pueden escribir el mismo userName y antes eso mezclaba sus
              // roles y botones de permisos.
              const member = userId ? members.find((m) => m.userId === userId) : undefined;
              const canChangeRole = isCurrentUserAdmin && member && member.role !== 'administrador';
              const color = nameColorHex(nameColor);
              return (
                <li key={participantId}>
                  <span style={color ? { color } : undefined}>{userName}</span>
                  {!userId && <span> ({t('Invitado')})</span>}
                  {member && <RoleTag role={member.role} />}
                  {canChangeRole && (
                    <button
                      type="button"
                      className={roleTagStyles.roleButton}
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
      )}
    </>
  );

  return (
    <>
      {callOverlay}
      <div className={styles.roomLayout}>
        <RoomSidebar
          code={code}
          copied={copied}
          onCopyLink={handleCopyLink}
          open={sidebarOpen}
          width={sidebarResize.width}
          onResizeHandleMouseDown={sidebarResize.handleMouseDown}
        />
        <button
          type="button"
          className={styles.sidebarToggleButton}
          style={{ left: sidebarOpen ? sidebarResize.width - 46 : 12 }}
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? t('Ocultar panel lateral') : t('Mostrar panel lateral')}
          title={sidebarOpen ? t('Ocultar panel lateral') : t('Mostrar panel lateral')}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="10" y1="4" x2="10" y2="20" />
          </svg>
        </button>

        <div className={styles.roomMain}>
          {notice && (
            <div className={styles.notice}>
              {'text' in notice
                ? notice.text
                : `${notice.userName} ${t(notice.event === 'joined' ? 'se unió a la sala' : 'salió de la sala')}`}
            </div>
          )}
          {membersError && (
            <p className={styles.error} role="alert">
              {membersError}
            </p>
          )}

          <div className={styles.meetingAndChat}>
            {callSession.session && <MeetingRoom call={callSession} />}
            <button
              type="button"
              className={styles.chatToggleButton}
              onClick={() => setChatOpen((open) => !open)}
              aria-label={chatOpen ? t('Ocultar chat') : t('Mostrar chat')}
              title={chatOpen ? t('Ocultar chat') : t('Mostrar chat')}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </button>
            {callSession.session ? (
              // En llamada: el chat queda "acoplado" con ancho fijo y puede
              // colapsarse. Siempre se monta (no se condiciona con chatOpen),
              // porque es el wrapper el que anima `width` entre 0 y el ancho
              // elegido — si se condicionara el montaje, desaparecería de
              // golpe en vez de animarse (ver RoomSidebar para el mismo
              // patrón, ya usado en la sidebar izquierda).
              <div
                className={styles.chatPanelInCallWrap}
                data-open={chatOpen}
                style={{ '--chat-width': `${chatResize.width}px` } as CSSProperties}
              >
                <div
                  className={styles.chatResizeHandle}
                  onMouseDown={chatResize.handleMouseDown}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('Ajustar ancho del chat')}
                />
                <div
                  className={`${styles.chatPanel} ${styles.chatPanelInCall}`}
                  style={{ width: chatResize.width }}
                >
                  {chatContent}
                </div>
              </div>
            ) : (
              // Sin llamada activa el chat es el único contenido de
              // .meetingAndChat (no hay nada más al lado para "acoplarse"),
              // así que se mantiene el mismo mostrar/ocultar simple de antes.
              chatOpen && <div className={styles.chatPanel}>{chatContent}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
