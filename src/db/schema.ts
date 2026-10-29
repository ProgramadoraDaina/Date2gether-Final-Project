import { relations } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  authorName: varchar('author_name', { length: 60 }).notNull(),
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
