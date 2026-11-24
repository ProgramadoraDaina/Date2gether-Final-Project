'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { AvatarDirectoryProvider } from '@/features/avatar/AvatarDirectory';
import { buildAvatarDirectory } from '@/features/avatar/directoryContext';
import { useShareMyAvatar } from '@/features/avatar/useShareMyAvatar';
import { ExpressionPicker, type ExpressionTab } from '@/features/chat/ExpressionPicker';
import { MentionInput } from '@/features/chat/MentionInput';
import { isSelfMentioned, ROLE_MENTION_KEYWORDS } from '@/features/chat/mentions';
import { playMentionSound } from '@/features/chat/mentionSound';
import { MessageText } from '@/features/chat/MessageText';
import { useChatHistory } from '@/features/chat/useChatHistory';
import { RoomEmojiShortcuts } from '@/features/chat/RoomEmojiShortcuts';
import { AppShell } from '@/features/navigation/AppShell';
import { RoomEmojisDialog } from '@/features/room-emojis/RoomEmojisDialog';
import { useRoomEmojis } from '@/features/room-emojis/useRoomEmojis';
import { RoleTag } from '@/features/rooms/RoleTag';
import { MemberRoleMenu } from '@/features/rooms/MemberRoleMenu';
import { RoomSidebar } from '@/features/rooms/RoomSidebar';
import { useResizablePanel } from '@/features/rooms/useResizablePanel';
import { AdmissionControl } from '@/features/rooms/AdmissionControl';
import { WaitingRoom } from '@/features/rooms/WaitingRoom';
import { useAdmissionRequest } from '@/features/rooms/useAdmissionRequest';
import { useRoomMembers } from '@/features/rooms/useRoomMembers';
import { useRoomNotes } from '@/features/rooms/useRoomNotes';
import {
  ApiError,
  getRoomInfo,
  requestRoomAccess,
  type ChatHistoryPage,
  type ChatMessage,
  type RoomAccess,
  type RoomEmoji,
} from '@/lib/api';
import { PreCallLobby } from '@/features/calls/PreCallLobby';
import { DEFAULT_CALL_DEVICES, type CallDevices } from '@/features/calls/callDevices';
import { useCallSession } from '@/features/calls/useCallSession';
import { TranscriptDialog } from '@/features/calls/transcription/TranscriptDialog';
import { HangUpButton } from '@/features/calls/HangUpButton';
import { EventTicker } from '@/features/calls/roomEvents/EventTicker';
import { PollPanel } from '@/features/calls/roomEvents/PollPanel';
import { RoomEventButton } from '@/features/calls/roomEvents/RoomEventButton';
import { RouletteWheel } from '@/features/calls/roomEvents/RouletteWheel';
import { useRoomEvents } from '@/features/calls/roomEvents/useRoomEvents';
import { useRoomMediaLock } from '@/features/calls/useRoomMediaLock';
import { useNameFocusSetting } from '@/features/calls/useNameFocusSetting';
import { createRoomSocket } from '@/lib/socket';
import { useTranslation } from '@/features/translation/useTranslation';
import { NAME_COLOR_HEX, isNameColorId } from '@/lib/nameColors';
import styles from './page.module.css';

const MeetingRoom = dynamic(() => import('@/features/calls/MeetingRoom'), { ssr: false });
const AmbientMusicPlayer = dynamic(
  () => import('@/features/calls/AmbientMusicPlayer').then((m) => m.AmbientMusicPlayer),
  { ssr: false },
);

const NAME_KEY = 'date2gether:userName';

type Notice = { text: string } | { event: 'joined' | 'left'; userName: string };

// Presencia en vivo del socket (no confundir con RoomMember de '@/lib/api',
// que es el registro de roles persistido en el backend).
interface RoomPresence {
  participantId: string;
  userName: string;
  userId?: string;
  // Solo cuentas que eligieron un color en /settings; ausente/null en invitados.
  nameColor?: string | null;
  // Se valida con toAvatar al armar el directorio de los tiles.
  avatar?: unknown;
}

// El id ya viene validado por el backend (uno de los 8 de NAME_COLOR_HEX),
// pero se revalida acá antes de indexar para no romper si llega otro valor.
function nameColorHex(nameColor?: string | null): string | undefined {
  if (!nameColor || !isNameColorId(nameColor)) return undefined;
  return NAME_COLOR_HEX[nameColor];
}

function personalNotesKey(roomCode: string, participant: RoomAccess['participant']): string {
  const identity = participant.userId ?? `guest:${participant.name.trim().toLocaleLowerCase()}`;
  return `date2gether:notes:${roomCode}:${identity}`;
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

// Desktop keeps the panel glyph; phones show a close cross because the panel covers the call.
function PanelCloseIcon() {
  return (
    <>
      <span className={styles.desktopOnly}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="10" y1="4" x2="10" y2="20" />
        </svg>
      </span>
      <span className={styles.mobileOnly}>
        <CloseIcon />
      </span>
    </>
  );
}

export default function RoomPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Dismiss manual del panel de cierre forzado (D5, design.md): "Volver a
  // la sala" no reinicia la llamada (no hay flujo de reingreso en este PR),
  // solo deja de mostrar el panel para que el usuario siga viendo el chat.
  const [callEndedDismissed, setCallEndedDismissed] = useState(false);
  const [users, setUsers] = useState<RoomPresence[]>([]);
  const [mentionNames, setMentionNames] = useState<string[]>([]);
  const chatHistory = useChatHistory(code, access?.token);
  const { startJoin, receiveHistory, receiveMessage, page: chatPage } = chatHistory;
  const messageMentionNames = useMemo(
    () => [
      ...new Set([
        ...mentionNames,
        ...chatPage.entries.map((message) => message.authorName),
        ...ROLE_MENTION_KEYWORDS,
      ]),
    ],
    [mentionNames, chatPage.entries],
  );
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 'text' in notice ? 6000 : 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  const [chatTab, setChatTab] = useState<'chat' | 'presentes' | 'notas'>('chat');
  const [notesTab, setNotesTab] = useState<'personal' | 'sala'>('personal');
  const [personalNotes, setPersonalNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState('');
  const sharedNotes = useRoomNotes(
    code,
    access?.token,
    access ? `${personalNotesKey(code, access.participant)}:shared-draft` : undefined,
  );
  const sharedNotesStatus = {
    loading: 'Cargando notas de sala…',
    ready: 'Estas notas son compartidas con la sala',
    pending: 'Guardando…',
    saving: 'Guardando…',
    saved: 'Notas guardadas',
    'load-error': 'No se pudieron cargar las notas de sala',
    'save-error': 'No se pudieron guardar las notas. Tu borrador se conserva.',
    conflict: 'Otra persona actualizó las notas. Revisá ambas versiones antes de guardar.',
  }[sharedNotes.status];
  const [chatOpen, setChatOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // On phones each panel covers the whole screen, so opening one closes the other.
  const isPhone = () => window.matchMedia?.('(max-width: 640px)').matches ?? false;
  function toggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    if (next && isPhone()) setChatOpen(false);
  }
  function toggleChat() {
    const next = !chatOpen;
    setChatOpen(next);
    if (next && isPhone()) setSidebarOpen(false);
  }

  // On phones both panels cover the call, so they start closed.
  useEffect(() => {
    if (isPhone()) {
      setSidebarOpen(false);
      setChatOpen(false);
    }
  }, []);
  const [isPermanentRoom, setIsPermanentRoom] = useState(false);
  useEffect(() => {
    getRoomInfo(code).then(
      (room) => setIsPermanentRoom(room.isPermanent),
      () => setIsPermanentRoom(false),
    );
  }, [code]);
  // Además del ref (que el resto del componente ya usaba para emitir desde
  // handlers sin re-render), se guarda en estado para pasarlo como prop a
  // MeetingRoom: mutar un ref no dispara un re-render, así que sin esto
  // AmbientMusicPlayer podía quedarse con socket=null aunque el ref ya
  // tuviera la conexión real.
  const [roomSocket, setRoomSocket] = useState<Socket | null>(null);
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
  const { joinCall } = callSession;
  const [initialDevices, setInitialDevices] = useState(DEFAULT_CALL_DEVICES);
  const [emojisOpen, setEmojisOpen] = useState(false);
  const [transcriptCallSid, setTranscriptCallSid] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [roomDeleted, setRoomDeleted] = useState(false);
  const { emojis, refetchEmojis } = useRoomEmojis(access ? code : undefined);
  const chatEmojis = useMemo(() => emojis.filter((e) => e.kind === 'emoji'), [emojis]);
  const emojisByName = useMemo(() => new Map(chatEmojis.map((e) => [e.name, e])), [chatEmojis]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<ExpressionTab>('emoji');
  const {
    members,
    currentUserRole,
    isCurrentUserAdmin,
    error: membersError,
    changeRole,
    refetchMembers,
  } = useRoomMembers(access ? code : undefined);
  // Sin userId = sin cuenta en la sala (room_members no tiene invitados):
  // es la señal para la @mención colectiva 'invitados' en mentions.ts.
  const isGuest = !access?.participant.userId;
  // A ref so switching language never reconnects the room socket.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const myMentionRoleKeywords = useMemo<string[]>(
    () => (isGuest ? ['invitados'] : currentUserRole ? [currentUserRole] : []),
    [isGuest, currentUserRole],
  );
  // Sugerencias del autocompletar @: gente presente + los 4 roles, así se
  // puede mencionar "a todos los colaboradores" sin tipear cada nombre.
  const mentionSuggestions = useMemo(
    () => [
      ...users,
      ...ROLE_MENTION_KEYWORDS.map((role) => ({ participantId: `role:${role}`, userName: role })),
    ],
    [users],
  );
  // Misma vara que RoomEmojisDialog (canManage): armar un evento es moderación
  // liviana de la sala, no exclusiva del admin.
  const canManageEvents = currentUserRole === 'administrador' || currentUserRole === 'colaborador';
  const roomEvents = useRoomEvents(roomSocket);
  const mediaLock = useRoomMediaLock(roomSocket);
  const nameFocus = useNameFocusSetting(roomSocket);
  useShareMyAvatar(roomSocket);
  const avatarDirectory = useMemo(() => buildAvatarDirectory(users), [users]);
  const eventParticipants = useMemo(
    () => users.map(({ participantId, userName }) => ({ participantId, userName })),
    [users],
  );
  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY) ?? '');
  }, []);

  const acceptAccess = useCallback((roomAccess: RoomAccess) => {
    localStorage.setItem(NAME_KEY, roomAccess.participant.name);
    setName(roomAccess.participant.name);
    setAccess(roomAccess);
  }, []);
  const admission = useAdmissionRequest(code, acceptAccess);

  useEffect(() => {
    if (!access) return;
    const key = personalNotesKey(code, access.participant);
    setPersonalNotes(localStorage.getItem(key) ?? '');
  }, [access, code]);

  async function handleJoin(devices: CallDevices) {
    if (!name.trim() || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const roomAccess = await requestRoomAccess(code, name.trim());
      setInitialDevices(devices);
      if ('token' in roomAccess) acceptAccess(roomAccess);
      else admission.start(roomAccess);
    } catch (error) {
      setJoinError(error instanceof ApiError ? error.message : t('No se pudo entrar a la sala'));
    } finally {
      setJoining(false);
    }
  }

  // El lobby confirma nombre y dispositivos antes de conectar chat y medios.
  useEffect(() => {
    if (access) void joinCall(code, access.token);
  }, [access, code, joinCall]);

  // Una vez que se llegó a 'in-call' o 'error' por primera vez, no se vuelve
  // a tapar toda la pantalla aunque la llamada después falle o termine: ese
  // caso ya lo cubren callLoadingPanel/callEndedPanel dentro de la sala (ver
  // más abajo). Este flag solo gobierna la transición inicial de "Entrando a
  // la reunión" -> sala completa. Si no se cuenta 'error' acá, una llamada
  // que nunca logra conectar deja el overlay pegado para siempre tapando el
  // resto de la sala (chat incluido).
  const [hasJoinedCall, setHasJoinedCall] = useState(false);
  useEffect(() => {
    if (callSession.status === 'in-call' || callSession.status === 'error') {
      setHasJoinedCall(true);
    }
  }, [callSession.status]);

  useEffect(() => {
    if (!code || !access) return;
    const socket = createRoomSocket(access.token);
    socketRef.current = socket;
    setRoomSocket(socket);

    socket.on('connect', () => {
      startJoin();
      socket.emit('joinRoom', { code });
    });

    socket.on('error', ({ message }: { message: string }) => {
      setNotice({ text: message });
    });
    socket.on('exception', ({ message }: { message: string }) => setNotice({ text: message }));
    socket.on('connect_error', () =>
      setNotice({ text: tRef.current('No se pudo conectar a la sala') }),
    );

    function rememberNames(names: string[]) {
      setMentionNames((prev) => Array.from(new Set([...prev, ...names])));
    }
    socket.on('roomHistory', (history: ChatHistoryPage) => {
      receiveHistory(history);
      rememberNames(history.entries.map((message) => message.authorName));
    });
    socket.on('roomUsers', (list: RoomPresence[]) => {
      setUsers(list);
      rememberNames(list.map((user) => user.userName));
      void refetchMembers();
    });

    socket.on('userJoined', (joined: RoomPresence) => {
      rememberNames([joined.userName]);
      if (joined.userId) void refetchMembers();
      setUsers((prev) =>
        prev.some((u) => u.participantId === joined.participantId) ? prev : [...prev, joined],
      );
      setNotice({ event: 'joined', userName: joined.userName });
    });

    socket.on('avatarChanged', ({ participantId, avatar }: RoomPresence) => {
      setUsers((prev) =>
        prev.map((u) => (u.participantId === participantId ? { ...u, avatar } : u)),
      );
    });

    socket.on('userLeft', (left: RoomPresence) => {
      setUsers((prev) => prev.filter((u) => u.participantId !== left.participantId));
      setNotice({ event: 'left', userName: left.userName });
    });

    socket.on('newMessage', (message: ChatMessage) => {
      receiveMessage(message);
      // Nunca te notifica tu propio mensaje, aunque te auto-menciones.
      if (
        message.kind === 'text' &&
        message.authorName !== access.participant.name &&
        isSelfMentioned(message.content, {
          name: access.participant.name,
          roleKeywords: myMentionRoleKeywords,
        })
      ) {
        playMentionSound();
      }
    });

    // El REST de roles (useRoomMembers) no tiene su propio socket: cuando
    // un admin cambia un rol, el backend avisa por este evento y acá se
    // dispara el refetch para que se vea sin recargar la página.
    socket.on('memberRoleChanged', () => {
      refetchMembers();
    });
    socket.on('roomEmojisChanged', () => {
      void refetchEmojis();
    });
    // La sala se borró (su administrador): el backend corta chat y llamada, y desde
    // acá se reemplaza toda la vista por un aviso en vez de dejar una sala muerta.
    socket.on('roomDeleted', () => setRoomDeleted(true));

    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setRoomSocket(null);
    };
  }, [
    code,
    access,
    myMentionRoleKeywords,
    refetchMembers,
    refetchEmojis,
    startJoin,
    receiveHistory,
    receiveMessage,
  ]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatPage.entries]);

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    socketRef.current?.emit('sendMessage', { content: draft.trim() });
    setDraft('');
  }

  function handleGifSelect(url: string) {
    socketRef.current?.emit('sendMessage', { kind: 'gif', content: url });
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

  function handleRoomEmojiSelect(emoji: RoomEmoji) {
    handleEmojiSelect(`:${emoji.name}: `);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setNotice({ text: t('No se pudo copiar el enlace') });
    }
  }

  if (!access) {
    return (
      <AppShell>
        {admission.receipt ? (
          <WaitingRoom code={code} admission={admission} />
        ) : (
          <PreCallLobby
            code={code}
            name={name}
            onNameChange={setName}
            joining={joining}
            error={joinError}
            onJoin={handleJoin}
          />
        )}
      </AppShell>
    );
  }

  if (roomDeleted) {
    return (
      <AppShell>
        <div className={styles.callLoadingPanel} role="alert">
          <p>{t('Esta sala fue eliminada por su administrador.')}</p>
          <div className={styles.callEndedActions}>
            <Link href="/rooms" className={styles.callLoadingButton}>
              {t('Ir a mis salas')}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  // A diferencia de antes, este estado de "conectando"/"error" NO tapa toda
  // la pantalla: el chat y la lista de presentes se pueden usar desde que se
  // entra a la sala, sin esperar a que la llamada de audio/video termine de
  // conectar (ni dependen de que llegue a conectar en absoluto).
  // Resetea el intento de llamada y vuelve al inicio: equivalente a "Colgar"
  // para cuando MeetingRoom (y su LiveKitRoom) todavía ni se montaron, así
  // que no hay nada de LiveKit que desconectar — ver HangUpButton.tsx.
  function leaveFailedOrConnectingCall() {
    callSession.leaveCall();
    router.push('/');
  }

  const callLoadingPanel = (
    <div className={styles.callLoadingPanel} role="status" aria-live="polite">
      {callSession.status === 'error' ? (
        <>
          <p>{callSession.error ? t(callSession.error) : t('No se pudo conectar a la llamada')}</p>
          <div className={styles.callEndedActions}>
            <button
              type="button"
              className={styles.callLoadingButton}
              onClick={() => callSession.joinCall(code, access.token)}
            >
              {t('Reintentar')}
            </button>
            <HangUpButton
              className={styles.callLoadingButton}
              onConfirm={leaveFailedOrConnectingCall}
            >
              {t('Colgar')}
            </HangUpButton>
          </div>
        </>
      ) : (
        <>
          <div className={styles.callLoadingSpinner} />
          <p>{t('Cargando llamada…')}</p>
          <HangUpButton
            className={styles.callLoadingButton}
            onConfirm={leaveFailedOrConnectingCall}
          >
            {t('Colgar')}
          </HangUpButton>
        </>
      )}
    </div>
  );

  // Cierre forzado por el anfitrión (D5, design.md): estado terminal
  // distinto de 'error' — la llamada no falló, terminó porque se desconectó
  // el último administrador. "Ver línea de tiempo" lleva al listado general
  // (todavía no hay un sessionId disponible del lado del cliente en este
  // momento: la cabecera de sesión se materializa recién al recibir
  // room_finished, de forma asíncrona). "Volver a la sala" solo descarta
  // este panel; la sala y el chat siguen disponibles sin cambios (alcance
  // exclusivo a la videollamada, spec host-gate/alcance-exclusivo).
  const callEndedPanel = (
    <div className={styles.callLoadingPanel} role="status" aria-live="polite">
      <p>{t('La llamada terminó porque el anfitrión se desconectó.')}</p>
      <div className={styles.callEndedActions}>
        <Link href="/history" className={styles.callLoadingButton}>
          {t('Ver línea de tiempo')}
        </Link>
        <button
          type="button"
          className={styles.callLoadingButton}
          onClick={() => setCallEndedDismissed(true)}
        >
          {t('Volver a la sala')}
        </button>
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
        <button
          type="button"
          className={`${styles.chatTab} ${chatTab === 'notas' ? styles.chatTabActive : ''}`}
          onClick={() => setChatTab('notas')}
        >
          {t('Notas')}
        </button>
      </div>
      {chatTab === 'chat' ? (
        <>
          <div className={styles.chatDateFilter}>
            <label htmlFor="chat-message-day">{t('Filtrar por día')}</label>
            <input
              id="chat-message-day"
              type="date"
              value={chatHistory.day}
              onChange={(event) => chatHistory.changeDay(event.target.value)}
            />
            {chatHistory.day && (
              <button type="button" onClick={() => chatHistory.changeDay('')}>
                {t('Limpiar filtro')}
              </button>
            )}
            {isPermanentRoom && (
              <button
                type="button"
                aria-pressed={chatHistory.archive}
                onClick={chatHistory.toggleArchive}
              >
                {t(chatHistory.archive ? 'Volver al chat reciente' : 'Ver archivo del chat')}
              </button>
            )}
            {chatHistory.archive && access.participant.userId && (
              <Link
                href={`/history?roomId=${encodeURIComponent(access.participant.roomId)}&roomArchive=1`}
              >
                {t('Ver archivo de llamadas')}
              </Link>
            )}
          </div>
          {(chatPage.nextCursor || chatHistory.before) && (
            <div className={styles.chatDateFilter}>
              {chatHistory.before && (
                <button type="button" onClick={() => chatHistory.goTo(null)}>
                  {t('Volver a la primera página')}
                </button>
              )}
              {chatPage.nextCursor && (
                <button type="button" onClick={() => chatHistory.goTo(chatPage.nextCursor)}>
                  {t('Mensajes anteriores')}
                </button>
              )}
            </div>
          )}
          <ul className={styles.messages} ref={listRef} data-testid="messages">
            {chatHistory.loading && (
              <li className={styles.chatFilterEmpty} role="status">
                {t('Cargando mensajes…')}
              </li>
            )}
            {chatHistory.error && (
              <li className={styles.chatFilterEmpty} role="alert">
                {t(chatHistory.error)}
              </li>
            )}
            {!chatHistory.loading &&
              !chatHistory.error &&
              chatPage.entries.length === 0 &&
              (chatHistory.day || chatHistory.archive || chatHistory.before) && (
                <li className={styles.chatFilterEmpty} role="status">
                  {t(
                    chatHistory.day
                      ? 'No hay mensajes de ese día.'
                      : 'No hay mensajes en esta página.',
                  )}
                </li>
              )}
            {chatPage.entries.map((m) => {
              // No hay un id de autor persistido por mensaje: el color se
              // resuelve cruzando por nombre contra la presencia actual.
              // Es una simplificación aceptada para v1 (ver comentario en
              // el PR): un mensaje viejo de alguien que ya se fue, o una
              // colisión de nombres entre dos personas distintas, puede
              // quedar sin color o con el color equivocado.
              const presence = users.find((u) => u.userName === m.authorName);
              const color = nameColorHex(presence?.nameColor);
              const mentionsMe =
                m.kind === 'text' &&
                isSelfMentioned(m.content, {
                  name: access?.participant.name ?? '',
                  roleKeywords: myMentionRoleKeywords,
                });
              return (
                <li
                  key={m.id}
                  className={
                    mentionsMe ? `${styles.message} ${styles.messageMentioned}` : styles.message
                  }
                >
                  <span className={styles.author} style={color ? { color } : undefined}>
                    {m.authorName}
                  </span>
                  {m.kind === 'gif' ? (
                    <img className={styles.gifMessage} src={m.content} alt="GIF" loading="lazy" />
                  ) : (
                    <MessageText
                      text={m.content}
                      roomCode={code}
                      emojisByName={emojisByName}
                      mentionNames={messageMentionNames}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {!chatHistory.archive && (
            <>
              <RoomEmojiShortcuts
                roomCode={code}
                emojis={chatEmojis}
                onSelect={handleRoomEmojiSelect}
                onShowAll={() => {
                  setPickerTab('room');
                  setPickerOpen(true);
                }}
              />
              <form className={styles.messageForm} onSubmit={handleSend}>
                <ExpressionPicker
                  roomCode={code}
                  roomToken={access.token}
                  roomEmojis={chatEmojis}
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  tab={pickerTab}
                  onTabChange={setPickerTab}
                  onEmojiSelect={handleEmojiSelect}
                  onGifSelect={handleGifSelect}
                  onRoomEmojiSelect={handleRoomEmojiSelect}
                />
                <MentionInput
                  value={draft}
                  onChange={setDraft}
                  inputRef={draftInputRef}
                  users={mentionSuggestions}
                  placeholder={t('Escribí un mensaje...')}
                  label={t('Mencionar participante')}
                />
                <button type="submit">{t('Enviar')}</button>
              </form>
            </>
          )}
        </>
      ) : chatTab === 'presentes' ? (
        <div className={styles.usersPanel} data-testid="users-panel">
          <h3>
            {t('En la sala')} ({users.length})
          </h3>
          <ul>
            {users.map(({ participantId, userName, userId, nameColor }) => {
              // Se cruza por userId (único), no por nombre: dos personas
              // pueden escribir el mismo userName y antes eso mezclaba sus
              // roles y botones de permisos.
              const member = userId ? members.find((m) => m.userId === userId) : undefined;
              const canChangeRole = isCurrentUserAdmin && member && !member.isOwner;
              const color = nameColorHex(nameColor);
              return (
                <li key={participantId}>
                  <div className={styles.memberIdentity}>
                    <span style={color ? { color } : undefined}>{userName}</span>
                    {!userId && <span> ({t('Invitado')})</span>}
                    {member && (
                      <RoleTag
                        role={member.role}
                        ownerLabel={member.isOwner ? t('Propietario') : undefined}
                      />
                    )}
                  </div>
                  {canChangeRole && (
                    <MemberRoleMenu
                      member={member}
                      name={userName}
                      isLastAdmin={
                        member.role === 'administrador' &&
                        members.filter((m) => m.role === 'administrador').length === 1
                      }
                      onChangeRole={changeRole}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <section className={styles.notesPanel}>
          <div className={styles.notesTabs}>
            <button
              type="button"
              aria-pressed={notesTab === 'personal'}
              onClick={() => setNotesTab('personal')}
            >
              {t('Personales')}
            </button>
            <button
              type="button"
              aria-pressed={notesTab === 'sala'}
              onClick={() => setNotesTab('sala')}
            >
              {t('De la sala')}
            </button>
          </div>
          <textarea
            aria-label={
              notesTab === 'personal' ? t('Notas personales') : t('Notas compartidas de la sala')
            }
            placeholder={t('Escribí tus notas...')}
            value={notesTab === 'personal' ? personalNotes : sharedNotes.content}
            disabled={notesTab === 'sala' && ['loading', 'load-error'].includes(sharedNotes.status)}
            onChange={(event) => {
              if (notesTab === 'personal') {
                const value = event.target.value;
                setPersonalNotes(value);
                localStorage.setItem(personalNotesKey(code, access.participant), value);
                setNotesStatus(t('Notas guardadas en este dispositivo'));
              } else {
                sharedNotes.edit(event.target.value);
              }
            }}
            maxLength={20000}
          />
          <small aria-live="polite">
            {notesTab === 'personal'
              ? notesStatus || t('Solo vos podés ver estas notas')
              : t(sharedNotesStatus)}
          </small>
          {notesTab === 'sala' && ['load-error', 'save-error'].includes(sharedNotes.status) && (
            <button type="button" onClick={sharedNotes.retry}>
              {t('Reintentar')}
            </button>
          )}
          {notesTab === 'sala' &&
            sharedNotes.status === 'conflict' &&
            (sharedNotes.remote ? (
              <div className={styles.notesConflict}>
                <label htmlFor="room-notes-remote">{t('Versión actual de la sala')}</label>
                <textarea id="room-notes-remote" value={sharedNotes.remote.content} readOnly />
                <button type="button" onClick={() => sharedNotes.resolveConflict(false)}>
                  {t('Descartar mi borrador y usar la versión de sala')}
                </button>
                <button type="button" onClick={() => sharedNotes.resolveConflict(true)}>
                  {t('Reemplazar la versión de sala con mi borrador')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={sharedNotes.retry}>
                {t('Cargar versión actual')}
              </button>
            ))}
        </section>
      )}
    </>
  );

  return (
    <>
      <RoomEmojisDialog
        code={code}
        open={emojisOpen}
        onClose={() => setEmojisOpen(false)}
        emojis={emojis}
        canManage={currentUserRole === 'administrador' || currentUserRole === 'colaborador'}
      />
      {access && transcriptCallSid && (
        <TranscriptDialog
          open={transcriptOpen}
          onClose={() => setTranscriptOpen(false)}
          roomCode={code}
          roomToken={access.token}
          callSid={transcriptCallSid}
          callEnded={callEnded}
        />
      )}
      <div className={styles.roomLayout}>
        <RoomSidebar
          code={code}
          copied={copied}
          onCopyLink={handleCopyLink}
          onOpenEmojis={() => setEmojisOpen(true)}
          onOpenTranscript={transcriptCallSid ? () => setTranscriptOpen(true) : undefined}
          open={sidebarOpen}
          width={sidebarResize.width}
          onResizeHandleMouseDown={sidebarResize.handleMouseDown}
          // "Salir" (sin confirmar) solo tiene sentido cuando no hay ningún
          // intento de llamada en curso: conectando y error ya tienen su
          // propio botón "Colgar" (con confirmación) en callLoadingPanel, y
          // 'in-call' lo tiene en el dock de MeetingRoom. 'ended' (el
          // anfitrión se desconectó) es la excepción: ahí no hay nada que
          // colgar, la llamada ya terminó del lado del servidor.
          inCall={
            callSession.status === 'connecting' ||
            callSession.status === 'in-call' ||
            callSession.status === 'error'
          }
          musicPlayer={
            roomSocket && (
              <AmbientMusicPlayer
                socket={roomSocket}
                isAdmin={isCurrentUserAdmin}
                roomCode={code}
                roomToken={access.token}
                persistModes={isPermanentRoom}
                silenced={callEnded}
              />
            )
          }
          admissionControl={isCurrentUserAdmin && <AdmissionControl code={code} />}
          eventControl={
            <RoomEventButton
              canManage={canManageEvents}
              participants={eventParticipants}
              onStartRoulette={roomEvents.startRoulette}
              onStartPoll={roomEvents.startPoll}
            />
          }
        />
        <button
          type="button"
          className={styles.sidebarToggleButton}
          style={{ left: sidebarOpen ? sidebarResize.width - 46 : 12 }}
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? t('Ocultar panel lateral') : t('Mostrar panel lateral')}
          title={sidebarOpen ? t('Ocultar panel lateral') : t('Mostrar panel lateral')}
        >
          {sidebarOpen ? (
            <PanelCloseIcon />
          ) : (
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
          )}
        </button>

        <div className={styles.roomMain}>
          {notice && (
            <div className={styles.notice} data-testid="notice">
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
            {/* .meetingArea es el contenedor posicionado (position:relative)
                de los overlays de abajo (RouletteWheel/PollPanel/EventTicker):
                al tener su propio flex:3 en vez de heredar el de .meetingRoom/
                .callLoadingPanel, su caja nunca incluye el ancho del chat
                (chatPanelInCallWrap, hermano fuera de este div), así que los
                overlays la esquivan solos, con el mismo mecanismo estructural
                (flexbox) con el que ya esquivan la sidebar izquierda. */}
            <div className={styles.meetingArea}>
              {/* MeetingRoom se monta apenas hay credenciales (session), aunque
                  LiveKit todavía no haya confirmado la conexión: necesita estar
                  montado para que onConnected llegue a disparar 'in-call'. Se
                  mantiene oculto (data-hidden) hasta ese momento para que la
                  transición visual sea un único spinner continuo en vez de
                  pasar por la grilla de video todavía conectando. */}
              {callSession.session && (
                <div
                  className={styles.meetingRoomSlot}
                  data-hidden={callSession.status !== 'in-call'}
                >
                  <AvatarDirectoryProvider directory={avatarDirectory}>
                    <MeetingRoom
                      call={callSession}
                      roomCode={code}
                      roomToken={access.token}
                      roomEmojis={emojis}
                      initialDevices={initialDevices}
                      onTranscriptAvailable={setTranscriptCallSid}
                      onHangUp={
                        transcriptCallSid
                          ? () => {
                              setCallEnded(true);
                              setTranscriptOpen(true);
                            }
                          : undefined
                      }
                      isCurrentUserAdmin={isCurrentUserAdmin}
                      audioLocked={mediaLock.audioLocked}
                      videoLocked={mediaLock.videoLocked}
                      onSetAudioLock={mediaLock.setAudioLock}
                      onSetVideoLock={mediaLock.setVideoLock}
                      nameFocusEnabled={nameFocus.enabled}
                      onSetNameFocus={nameFocus.setEnabled}
                    />
                  </AvatarDirectoryProvider>
                </div>
              )}
              {/* Antes de hasJoinedCall ya se ve el mismo mensaje en
                  .enteringScreen (ver abajo): no duplicarlo acá también. */}
              {hasJoinedCall &&
                (callSession.status === 'ended'
                  ? !callEndedDismissed && callEndedPanel
                  : callSession.status !== 'in-call' && callLoadingPanel)}
              {roomEvents.spin && (
                <RouletteWheel
                  key={roomEvents.spin.startedAt}
                  state={roomEvents.spin}
                  onDone={roomEvents.dismissSpin}
                />
              )}
              {roomEvents.settled?.type === 'poll' && (
                <PollPanel
                  state={roomEvents.settled}
                  currentParticipantId={access.participant.sub}
                  canManage={canManageEvents}
                  onVote={roomEvents.castPollVote}
                  onClose={roomEvents.clearSettled}
                  onClosePoll={roomEvents.closePoll}
                />
              )}
              {roomEvents.settled?.type === 'roulette' && !roomEvents.spin && (
                <EventTicker state={roomEvents.settled} onClose={roomEvents.clearSettled} />
              )}
            </div>
            <button
              type="button"
              className={styles.chatToggleButton}
              onClick={toggleChat}
              aria-label={chatOpen ? t('Ocultar chat') : t('Mostrar chat')}
              title={chatOpen ? t('Ocultar chat') : t('Mostrar chat')}
            >
              {chatOpen ? (
                <CloseIcon />
              ) : (
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
              )}
            </button>
            {callSession.session ? (
              // Always mounted so closing the chat keeps its scroll and draft.
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
      {/* Mientras no se llegó a 'in-call' por primera vez, este overlay (fijo,
          pantalla completa) tapa todo .roomLayout, que igual sigue montado
          detrás: la sala, el chat y MeetingRoom ya se están conectando en
          segundo plano, así que al sacar el overlay todo aparece ya listo de
          una sola vez, en vez de ir apareciendo en pedazos. */}
      {!hasJoinedCall && (
        <div className={styles.enteringScreen}>
          <div className={styles.enteringCallWrap}>{callLoadingPanel}</div>
        </div>
      )}
    </>
  );
}
