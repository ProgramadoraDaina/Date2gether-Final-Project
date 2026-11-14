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
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  nameColor: nameColorEnum('name_color'),
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
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export const rooms = pgTable('rooms', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  waitingRoomEnabled: boolean('waiting_room_enabled').notNull().default(false),
  entryLocked: boolean('entry_locked').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Columna histórica de Chime conservada para no reescribir migraciones aplicadas.
  // LiveKit identifica las salas por su código y no utiliza esta columna.
  chimeMeetingId: varchar('chime_meeting_id', { length: 64 }),
});

export const MESSAGE_KINDS = ['text', 'gif'] as const;

export const messageKindEnum = pgEnum('message_kind', MESSAGE_KINDS);

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  authorName: varchar('author_name', { length: 60 }).notNull(),
  // En los mensajes 'gif', content es la URL del GIF.
  kind: messageKindEnum('kind').notNull().default('text'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.userId] })],
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
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [index('room_admission_room_status_idx').on(table.roomId, table.status)],
);

// Historial de llamadas: una fila por cada vez que una cuenta registrada
// se une exitosamente a una sala. Los invitados sin cuenta no generan fila.
export const callHistory = pgTable('call_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
});

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

export const roomsRelations = relations(rooms, ({ many }) => ({
  messages: many(messages),
  members: many(roomMembers),
  callHistory: many(callHistory),
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
export type RoomMember = typeof roomMembers.$inferSelect;
export type NewRoomMember = typeof roomMembers.$inferInsert;
export type RoomRole = (typeof roomRoleEnum.enumValues)[number];
export type CallHistory = typeof callHistory.$inferSelect;
export type NewCallHistory = typeof callHistory.$inferInsert;
export type NameColor = (typeof nameColorEnum.enumValues)[number];

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
    // Snapshot del rol al emitir el token; null para invitados. Promover o
    // transferir el rol durante la llamada está fuera de alcance (D1).
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
// ON CONFLICT (id) DO NOTHING, sin índice único adicional. Sin UPDATE, sin
// DELETE, sin FK a propósito: el log debe sobrevivir al borrado de salas y
// usuarios para cumplir la retención indefinida (D7).
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
    roomCode: varchar('room_code', { length: 20 }).notNull(),
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
    roomCode: varchar('room_code', { length: 20 }).notNull(),
    startedAt: timestamp('started_at').notNull(),
    // De room_finished.
    endedAt: timestamp('ended_at'),
    // 'last_admin_left' | 'livekit'.
    closeReason: varchar('close_reason', { length: 32 }),
    // Objetivo del compare-and-set de cierre forzado idempotente (D4).
    forcedCloseAt: timestamp('forced_close_at'),
    // Guard de idempotencia de la materialización ante reentregas de room_finished.
    materializedAt: timestamp('materialized_at'),
  },
  (table) => [
    unique('call_sessions_livekit_room_sid_unique').on(table.livekitRoomSid),
    index('call_sessions_room_id_started_at_idx').on(table.roomId, table.startedAt.desc()),
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
  ],
);

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
