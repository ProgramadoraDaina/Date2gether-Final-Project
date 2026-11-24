import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { UserAvatar } from '../modules/auth/avatar';

// Drizzle no trae una columna bytea propia: se declara con customType.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// Paleta fija de colores de nombre: el frontend usa exactamente la misma lista de ids.
export const NAME_COLOR_IDS = [
  'purple',
  'red',
  'teal',
  'amber',
  'navy',
  'orange',
  'green',
  'pink',
] as const;

export const nameColorEnum = pgEnum('name_color', NAME_COLOR_IDS);

// Rol GLOBAL de la cuenta (distinto del rol por sala, roomRoleEnum): 'admin' puede moderar
// usuarios y salas de toda la plataforma.
export const USER_ROLES = ['user', 'admin'] as const;

export const userRoleEnum = pgEnum('user_role', USER_ROLES);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  nameColor: nameColorEnum('name_color'),
  avatar: jsonb('avatar').$type<UserAvatar>(),
  role: userRoleEnum('role').notNull().default('user'),
  callHistoryDeletedBefore: timestamp('call_history_deleted_before'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  // id = jti del JWT de refresh, generado en la app antes de firmar el token.
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 20 }).notNull(), // .unique() removed — see rooms_code_code_pool_unique
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // Declared at creation and immutable. Permanent rooms never expire and never recycle their code.
    isPermanent: boolean('is_permanent').notNull().default(false),
    historyDeletedBefore: timestamp('history_deleted_before'),
    historyCleanupPending: boolean('history_cleanup_pending').notNull().default(false),
    // Drives the rolling 24h window for non-permanent rooms. Touched on "entry".
    lastEnteredAt: timestamp('last_entered_at').notNull().defaultNow(),
    // Code-pool marker, not a joinability source of truth. NULL = this room holds its code.
    retiredAt: timestamp('retired_at'),
    waitingRoomEnabled: boolean('waiting_room_enabled').notNull().default(false),
    entryLocked: boolean('entry_locked').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // Columna histórica de Chime conservada para no reescribir migraciones aplicadas.
    // LiveKit identifica las salas por su código y no utiliza esta columna.
    chimeMeetingId: varchar('chime_meeting_id', { length: 64 }),
  },
  (table) => [
    uniqueIndex('rooms_code_code_pool_unique')
      .on(table.code)
      .where(sql`${table.retiredAt} is null`),
    index('rooms_retirement_sweep_idx')
      .on(table.lastEnteredAt)
      .where(sql`${table.retiredAt} is null and ${table.isPermanent} = false`),
    index('rooms_history_cleanup_pending_idx')
      .on(table.id)
      .where(sql`${table.historyCleanupPending}`),
  ],
);

export const MESSAGE_KINDS = ['text', 'gif'] as const;

export const messageKindEnum = pgEnum('message_kind', MESSAGE_KINDS);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    authorName: varchar('author_name', { length: 60 }).notNull(),
    // En los mensajes 'gif', content es la URL del GIF.
    kind: messageKindEnum('kind').notNull().default('text'),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('messages_room_created_id_idx').on(table.roomId, table.createdAt, table.id)],
);

// Bloc compartido de la sala. La clave única permite actualizarlo como un
// documento único y evita exponer notas personales a otros participantes.
export const roomNotes = pgTable('room_notes', {
  roomId: uuid('room_id')
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  content: text('content').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const roomLinks = pgTable(
  'room_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    url: varchar('url', { length: 2048 }).notNull(),
    title: varchar('title', { length: 120 }),
    addedByName: varchar('added_by_name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('room_links_room_url_unique').on(table.roomId, table.url)],
);

// El rol es por sala: la misma persona puede ser admin en una y participante en otra.
export const roomRoleEnum = pgEnum('room_role', ['administrador', 'colaborador', 'participante']);

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roomRoleEnum('role').notNull().default('participante'),
    hiddenFromMyRooms: boolean('hidden_from_my_rooms').notNull().default(false),
    isOwner: boolean('is_owner').notNull().default(false),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    uniqueIndex('room_members_one_owner_per_room')
      .on(table.roomId)
      .where(sql`${table.isOwner}`),
    check(
      'room_members_owner_is_admin',
      sql`not ${table.isOwner} or ${table.role} = 'administrador'`,
    ),
  ],
);

export const admissionStatusEnum = pgEnum('admission_status', [
  'pending',
  'admitted',
  'rejected',
  'cancelled',
]);
export const roomAdmissionRequests = pgTable(
  'room_admission_requests',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    status: admissionStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // NULL means "no TTL" (permanent-room requests) — never a far-future sentinel.
    expiresAt: timestamp('expires_at'),
  },
  (table) => [index('room_admission_room_status_idx').on(table.roomId, table.status)],
);

export const roomScheduleSlots = pgTable(
  'room_schedule_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // 0 = Sunday … 6 = Saturday — same convention as JS Date#getDay().
    dayOfWeek: smallint('day_of_week').notNull(),
    // 'HH:MM', 24h wall-clock in `timezone`.
    timeOfDay: varchar('time_of_day', { length: 5 }).notNull(),
    // IANA zone name, never a numeric offset.
    timezone: varchar('timezone', { length: 64 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('room_schedule_slots_room_id_idx').on(table.roomId),
    unique('room_schedule_slots_room_day_time_tz_unique').on(
      table.roomId,
      table.dayOfWeek,
      table.timeOfDay,
      table.timezone,
    ),
    check('room_schedule_slots_day_of_week_valid', sql`${table.dayOfWeek} between 0 and 6`),
    check(
      'room_schedule_slots_time_of_day_valid',
      sql`${table.timeOfDay} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

export const roomScheduleSlotsRelations = relations(roomScheduleSlots, ({ one }) => ({
  room: one(rooms, { fields: [roomScheduleSlots.roomId], references: [rooms.id] }),
}));

export type RoomScheduleSlot = typeof roomScheduleSlots.$inferSelect;
export type NewRoomScheduleSlot = typeof roomScheduleSlots.$inferInsert;

export interface PlaylistTrack {
  videoId: string;
  title: string;
}

// Only permanent rooms persist their playlist; temporary rooms keep it in memory.
export const roomPlaylists = pgTable(
  'room_playlists',
  {
    roomId: uuid('room_id')
      .primaryKey()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    tracks: jsonb('tracks').$type<PlaylistTrack[]>().notNull().default([]),
    currentIndex: integer('current_index').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [check('room_playlists_current_index_valid', sql`${table.currentIndex} >= 0`)],
);

export type RoomPlaylist = typeof roomPlaylists.$inferSelect;

// Historial de llamadas: una fila por cada vez que una cuenta registrada
// se une exitosamente a una sala. Los invitados sin cuenta no generan fila.
export const callHistory = pgTable(
  'call_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at').notNull().defaultNow(),
  },
  (table) => [
    index('call_history_user_started_id_idx').on(
      table.userId,
      table.startedAt.desc(),
      table.id.desc(),
    ),
    index('call_history_user_room_started_id_idx').on(
      table.userId,
      table.roomId,
      table.startedAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const CALL_MODES = ['reaction', 'sticker'] as const;
export const STICKER_POSITIONS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export const STICKER_SIZES = ['small', 'medium', 'large'] as const;
export const STICKER_ANIMATIONS = ['static', 'float', 'spin', 'pulse', 'shake'] as const;
export const STICKER_DURATIONS = [5, 10, 30] as const;

export const callModeEnum = pgEnum('call_mode', CALL_MODES);
export const stickerPositionEnum = pgEnum('sticker_position', STICKER_POSITIONS);
export const stickerSizeEnum = pgEnum('sticker_size', STICKER_SIZES);
export const stickerAnimationEnum = pgEnum('sticker_animation', STICKER_ANIMATIONS);

// Emojis propios de cada sala, al estilo Discord. Los archivos van en la base porque el
// deploy de EC2 solo respalda PostgreSQL (pg_dump) y el backend no tiene volumen.
export const roomEmojis = pgTable(
  'room_emojis',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 32 }).notNull(),
    // Imagen subida o emoji Unicode elegido del picker: exactamente uno de los dos.
    image: bytea('image'),
    imageMime: varchar('image_mime', { length: 32 }),
    emoji: varchar('emoji', { length: 32 }),
    sound: bytea('sound'),
    soundMime: varchar('sound_mime', { length: 32 }),
    // Crédito obligatorio para sonidos de Freesound con licencia CC BY.
    soundAttribution: varchar('sound_attribution', { length: 300 }),
    // Cómo se muestra en la llamada: reacción flotante o sticker temporal sobre la cámara.
    callMode: callModeEnum('call_mode').notNull().default('reaction'),
    stickerDuration: smallint('sticker_duration').notNull().default(10),
    stickerPosition: stickerPositionEnum('sticker_position').notNull().default('top-right'),
    stickerSize: stickerSizeEnum('sticker_size').notNull().default('medium'),
    stickerAnimation: stickerAnimationEnum('sticker_animation').notNull().default('static'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // Versiona las URLs de imagen y sonido: los archivos se cachean como inmutables.
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('room_emojis_room_id_name_unique').on(table.roomId, table.name),
    // Emoji = imagen o Unicode (nunca los dos); sonido de sala = sin ninguno de los dos, con sonido.
    check('room_emojis_sticker_duration_valid', sql`${table.stickerDuration} in (5, 10, 30)`),
    check(
      'room_emojis_kind_valid',
      sql`not (${table.image} is not null and ${table.emoji} is not null) and (${table.image} is not null or ${table.emoji} is not null or ${table.sound} is not null)`,
    ),
  ],
);

export type RoomEmoji = typeof roomEmojis.$inferSelect;

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  callHistory: many(callHistory),
}));

// Frases finales de los subtítulos en vivo. call_sid es el sid de la sala de LiveKit:
// cambia en cada llamada, así el acta de una llamada no mezcla frases de otras.
export const transcriptLines = pgTable(
  'transcript_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    callSid: varchar('call_sid', { length: 64 }).notNull(),
    speakerName: varchar('speaker_name', { length: 60 }).notNull(),
    content: text('content').notNull(),
    spokenAt: timestamp('spoken_at').notNull().defaultNow(),
  },
  (table) => [index('transcript_lines_room_call_idx').on(table.roomId, table.callSid)],
);

export const roomsRelations = relations(rooms, ({ many, one }) => ({
  messages: many(messages),
  notes: one(roomNotes, { fields: [rooms.id], references: [roomNotes.roomId] }),
  members: many(roomMembers),
  callHistory: many(callHistory),
  scheduleSlots: many(roomScheduleSlots),
}));

export const roomNotesRelations = relations(roomNotes, ({ one }) => ({
  room: one(rooms, { fields: [roomNotes.roomId], references: [rooms.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  room: one(rooms, { fields: [messages.roomId], references: [rooms.id] }),
}));

export const roomMembersRelations = relations(roomMembers, ({ one }) => ({
  room: one(rooms, { fields: [roomMembers.roomId], references: [rooms.id] }),
  user: one(users, { fields: [roomMembers.userId], references: [users.id] }),
}));

export const callHistoryRelations = relations(callHistory, ({ one }) => ({
  room: one(rooms, { fields: [callHistory.roomId], references: [rooms.id] }),
  user: one(users, { fields: [callHistory.userId], references: [users.id] }),
}));

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type RoomNote = typeof roomNotes.$inferSelect;
export type RoomLink = typeof roomLinks.$inferSelect;
export type RoomMember = typeof roomMembers.$inferSelect;
export type NewRoomMember = typeof roomMembers.$inferInsert;
export type RoomRole = (typeof roomRoleEnum.enumValues)[number];
export type CallHistory = typeof callHistory.$inferSelect;
export type NewCallHistory = typeof callHistory.$inferInsert;
export type NameColor = (typeof nameColorEnum.enumValues)[number];
export type TranscriptLine = typeof transcriptLines.$inferSelect;

// ---------------------------------------------------------------------------
// Línea de tiempo de participación en llamadas (ver openspec/changes/
// call-participation-timeline/design.md). Las 4 tablas de abajo son aditivas:
// ninguna tabla ni relación existente se modifica.
// ---------------------------------------------------------------------------

// Correlación identity (LiveKit) ↔ usuario/invitado. Se escribe en
// CallsService.join(), el único lugar que tiene juntos participant.sub,
// participant.userId, participant.name y room.id. Es un upsert por
// livekitIdentity: el JWT de acceso a sala vive 24h con un sub fijo, así que
// POST /calls/:roomCode puede reintentarse con el mismo identity (D7).
export const callParticipantIdentities = pgTable(
  'call_participant_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    livekitIdentity: varchar('livekit_identity', { length: 64 }).notNull(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // null para invitados.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    // Snapshot del rol al emitir el token; null para invitados. La presencia
    // de anfitriones se determina con el rol actual de roomMembers.
    roleAtIssue: roomRoleEnum('role_at_issue'),
    issuedAt: timestamp('issued_at').notNull().defaultNow(),
  },
  (table) => [
    unique('call_participant_identities_livekit_identity_unique').on(table.livekitIdentity),
    index('call_participant_identities_room_id_user_id_idx').on(table.roomId, table.userId),
  ],
);

// Log append-only de los webhooks de LiveKit. El PK es el id del propio
// evento de LiveKit: la deduplicación sale gratis con
// ON CONFLICT (id) DO NOTHING, sin índice único adicional. Sin FK para
// conservar el log aunque exista un cambio en salas o usuarios. En salas
// permanentes, el borrado explícito del archivo también retira sus eventos.
export const callEvents = pgTable(
  'call_events',
  {
    // BUG CORREGIDO: no es un UUID. LiveKit usa su propio formato de id de
    // evento (p. ej. "EV_Qu5Dtyxm7rxe"), confirmado contra webhooks reales
    // en un despliegue EC2 — un uuid('id') rechazaba cada insert porque
    // Postgres no acepta ese string como UUID válido. La tabla nunca llegó
    // a tener filas reales con el tipo viejo, así que este cambio no pierde
    // datos.
    id: varchar('id', { length: 40 }).primaryKey(),
    livekitRoomSid: varchar('livekit_room_sid', { length: 64 }).notNull(),
    // room.name; sin FK a propósito (ver D7).
    roomCode: varchar('room_code', { length: 40 }).notNull(),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    // null en room_started / room_finished.
    livekitIdentity: varchar('livekit_identity', { length: 64 }),
    // null salvo eventos track_*.
    trackSource: varchar('track_source', { length: 24 }),
    // event.createdAt (epoch en segundos → Date).
    occurredAt: timestamp('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    // Separado de occurredAt: los webhooks llegan desordenados.
    receivedAt: timestamp('received_at').notNull().defaultNow(),
  },
  (table) => [
    index('call_events_room_sid_occurred_at_idx').on(table.livekitRoomSid, table.occurredAt),
    index('call_events_livekit_identity_idx').on(table.livekitIdentity),
  ],
);

// Cabecera de sesión (una por room.sid de LiveKit) y estado de cierre.
// Se crea en room_started con ON CONFLICT (livekit_room_sid) DO NOTHING; como
// los webhooks pueden llegar desordenados, los handlers de participant_*
// usan el mismo upsert (creación perezosa) antes de operar (D8).
export const callSessions = pgTable(
  'call_sessions',
  {
    // Id público de la URL de la línea de tiempo.
    id: uuid('id').defaultRandom().primaryKey(),
    livekitRoomSid: varchar('livekit_room_sid', { length: 64 }).notNull(),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    roomCode: varchar('room_code', { length: 40 }).notNull(),
    startedAt: timestamp('started_at').notNull(),
    // De room_finished.
    endedAt: timestamp('ended_at'),
    // 'last_admin_left' | 'livekit'.
    closeReason: varchar('close_reason', { length: 32 }),
    // Objetivo del compare-and-set de cierre forzado idempotente (D4).
    forcedCloseAt: timestamp('forced_close_at'),
    // Guard de idempotencia de la materialización ante reentregas de room_finished.
    materializedAt: timestamp('materialized_at'),
    // livekitRoomSid de la sesión PADRE del grupo (breakout-rooms/design.md D5.3).
    // null = sesión sin mini salas. Sin backfill: solo lo stampea el handler de
    // room_finished de una mini sala al resolver call_breakout_rooms.
    callGroupId: varchar('call_group_id', { length: 64 }),
    historyPurgedAt: timestamp('history_purged_at'),
  },
  (table) => [
    unique('call_sessions_livekit_room_sid_unique').on(table.livekitRoomSid),
    index('call_sessions_room_id_started_at_idx').on(table.roomId, table.startedAt.desc()),
    index('call_sessions_room_ended_history_idx')
      .on(table.roomId, table.endedAt, table.id)
      .where(sql`${table.endedAt} is not null and ${table.historyPurgedAt} is null`),
  ],
);

// Forma de almacenamiento de un intervalo (JSON ya serializado: fechas como
// string ISO, no Date — a diferencia de `TrackInterval` en
// aggregate-session.ts, que es la forma en memoria antes de insertar).
export interface CallSessionTrackInterval {
  source: 'camera' | 'microphone' | 'screen_share';
  startedAt: string;
  endedAt: string;
}

// Resumen materializado por participante, calculado una vez al recibir
// room_finished (aggregateSession(), función pura — ver design.md). Reusa la
// paleta de colores existente (nameColorEnum).
export const callSessionParticipants = pgTable(
  'call_session_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => callSessions.id, { onDelete: 'cascade' }),
    // user_id, o 'guest:' + lower(display_name). Colapsa varias identities
    // aleatorias de la misma persona en una sola fila (D8).
    participantKey: varchar('participant_key', { length: 80 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    isGuest: boolean('is_guest').notNull().default(false),
    firstJoinedAt: timestamp('first_joined_at').notNull(),
    lastLeftAt: timestamp('last_left_at'),
    totalSeconds: integer('total_seconds').notNull().default(0),
    // Micrófono publicado alguna vez. Redundante con trackIntervals (se
    // puede derivar filtrando source === 'microphone'), pero se conserva
    // como columna propia porque las vistas que solo necesitan "¿habló?"
    // no deberían tener que parsear el jsonb para una pregunta booleana.
    spoke: boolean('spoke').notNull().default(false),
    screenShared: boolean('screen_shared').notNull().default(false),
    rejoinCount: smallint('rejoin_count').notNull().default(0),
    // Intervalos reales de cámara/mic/pantalla (TrackInterval[] de
    // aggregate-session.ts): cuándo se prendió y cuándo se apagó cada vez,
    // no solo si pasó alguna vez. jsonb y no una tabla aparte porque es un
    // resumen derivado de solo lectura (igual que el resto de esta fila),
    // nunca se filtra por su contenido en SQL.
    trackIntervals: jsonb('track_intervals')
      .$type<CallSessionTrackInterval[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    nameColor: nameColorEnum('name_color'),
  },
  (table) => [
    unique('call_session_participants_session_id_participant_key_unique').on(
      table.sessionId,
      table.participantKey,
    ),
    index('call_session_participants_session_id_idx').on(table.sessionId),
    index('call_session_participants_user_joined_idx').on(
      table.userId,
      table.firstJoinedAt.desc(),
      table.sessionId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Mini salas dentro de una llamada (ver openspec/changes/breakout-rooms/
// design.md D4/D5). Tablas operativas aditivas: ninguna tabla existente
// cambia de semántica (call_sessions solo gana la columna call_group_id).
// ---------------------------------------------------------------------------

// Mini sala de LiveKit acotada a una sala padre. Vida corta (minutos), sin
// identidad de producto propia — a diferencia de `rooms` (D4).
export const callBreakoutRooms = pgTable(
  'call_breakout_rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // `${roomCode}::breakout-N` — reusado entre ciclos abrir/cerrar del mismo slot.
    livekitRoomName: varchar('livekit_room_name', { length: 40 }).notNull(),
    // sid de la sala PADRE (D5.2), capturado al crear vía listRooms([parentCode]).
    parentLivekitRoomSid: varchar('parent_livekit_room_sid', { length: 64 }),
    label: varchar('label', { length: 60 }).notNull(),
    // 'locked' | 'free_return'. varchar y no pgEnum: mismo precedente que
    // call_sessions.close_reason — es operativo, no una taxonomía de dominio.
    leavePolicy: varchar('leave_policy', { length: 16 }).notNull().default('locked'),
    // Decisión 3 (breakout-rooms-ux-fix/design.md "joinPolicy: esquema,
    // migración y autorización"): 'admin_only' | 'open'. Gobierna el
    // movimiento HACIA DENTRO por iniciativa propia -- separado de
    // leavePolicy, que gobierna la VUELTA a la principal. Mismo precedente
    // varchar que leavePolicy, documentado arriba.
    joinPolicy: varchar('join_policy', { length: 16 }).notNull().default('admin_only'),
    // null = sin timer de cierre automático.
    autoCloseAt: timestamp('auto_close_at'),
    // null = abierta. Objetivo del compare-and-set de cierre.
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('call_breakout_rooms_livekit_room_name_unique').on(table.livekitRoomName),
    index('call_breakout_rooms_room_id_closed_at_idx').on(table.roomId, table.closedAt),
  ],
);

// Correlación identity ↔ ocupante trasladado a una mini sala (D5.1, D7). Se
// escribe antes de emitir el token de la mini sala, igual que
// call_participant_identities en join().
export const callBreakoutOccupants = pgTable(
  'call_breakout_occupants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    breakoutRoomId: uuid('breakout_room_id')
      .notNull()
      .references(() => callBreakoutRooms.id, { onDelete: 'cascade' }),
    // participant.sub del pase de la sala principal (estable 24h): la clave
    // con la que join() reconoce al solicitante que quiere volver.
    sourceIdentity: varchar('source_identity', { length: 64 }).notNull(),
    // Identity NUEVA emitida para la mini sala (D7) — nunca el mismo sub.
    livekitIdentity: varchar('livekit_identity', { length: 64 }).notNull(),
    // null para invitados.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
    // null = asignación abierta.
    returnedAt: timestamp('returned_at'),
  },
  (table) => [
    unique('call_breakout_occupants_livekit_identity_unique').on(table.livekitIdentity),
    index('call_breakout_occupants_breakout_room_id_open_idx')
      .on(table.breakoutRoomId)
      .where(sql`${table.returnedAt} is null`),
    index('call_breakout_occupants_source_identity_open_idx')
      .on(table.sourceIdentity)
      .where(sql`${table.returnedAt} is null`),
  ],
);

export const callBreakoutRoomsRelations = relations(callBreakoutRooms, ({ one, many }) => ({
  room: one(rooms, { fields: [callBreakoutRooms.roomId], references: [rooms.id] }),
  occupants: many(callBreakoutOccupants),
}));

export const callBreakoutOccupantsRelations = relations(callBreakoutOccupants, ({ one }) => ({
  breakoutRoom: one(callBreakoutRooms, {
    fields: [callBreakoutOccupants.breakoutRoomId],
    references: [callBreakoutRooms.id],
  }),
  user: one(users, { fields: [callBreakoutOccupants.userId], references: [users.id] }),
}));

export type CallBreakoutRoom = typeof callBreakoutRooms.$inferSelect;
export type NewCallBreakoutRoom = typeof callBreakoutRooms.$inferInsert;
export type CallBreakoutOccupant = typeof callBreakoutOccupants.$inferSelect;
export type NewCallBreakoutOccupant = typeof callBreakoutOccupants.$inferInsert;

export const callParticipantIdentitiesRelations = relations(
  callParticipantIdentities,
  ({ one }) => ({
    room: one(rooms, { fields: [callParticipantIdentities.roomId], references: [rooms.id] }),
    user: one(users, { fields: [callParticipantIdentities.userId], references: [users.id] }),
  }),
);

export const callSessionsRelations = relations(callSessions, ({ one, many }) => ({
  room: one(rooms, { fields: [callSessions.roomId], references: [rooms.id] }),
  participants: many(callSessionParticipants),
}));

export const callSessionParticipantsRelations = relations(callSessionParticipants, ({ one }) => ({
  session: one(callSessions, {
    fields: [callSessionParticipants.sessionId],
    references: [callSessions.id],
  }),
  user: one(users, { fields: [callSessionParticipants.userId], references: [users.id] }),
}));

export type CallParticipantIdentity = typeof callParticipantIdentities.$inferSelect;
export type NewCallParticipantIdentity = typeof callParticipantIdentities.$inferInsert;
export type CallEvent = typeof callEvents.$inferSelect;
export type NewCallEvent = typeof callEvents.$inferInsert;
export type CallSession = typeof callSessions.$inferSelect;
export type NewCallSession = typeof callSessions.$inferInsert;
export type CallSessionParticipant = typeof callSessionParticipants.$inferSelect;
export type NewCallSessionParticipant = typeof callSessionParticipants.$inferInsert;
