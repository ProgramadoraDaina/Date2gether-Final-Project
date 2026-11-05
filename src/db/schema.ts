import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
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
