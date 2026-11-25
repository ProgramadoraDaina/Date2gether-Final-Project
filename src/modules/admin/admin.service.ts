import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { users, type UserRole } from '../../db/schema';
import { RoomsService } from '../rooms/rooms.service';

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

const ADMIN_USER_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomsService: RoomsService,
  ) {}

  async listUsers(): Promise<AdminUserView[]> {
    return this.db.select(ADMIN_USER_COLUMNS).from(users).orderBy(asc(users.createdAt));
  }

  async setUserRole(actorId: string, targetId: string, role: UserRole): Promise<AdminUserView> {
    // Evita el bloqueo: si un admin pudiera quitarse el rol, podría dejar la plataforma sin admins.
    if (actorId === targetId && role !== 'admin') {
      throw new BadRequestException('No podés quitarte el rol de administrador a vos mismo');
    }
    const [updated] = await this.db
      .update(users)
      .set({ role })
      .where(eq(users.id, targetId))
      .returning(ADMIN_USER_COLUMNS);
    if (!updated) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return updated;
  }

  // Moderación: el mismo borrado que usa el administrador de la sala, sin exigir membresía.
  async deleteRoom(code: string): Promise<void> {
    await this.roomsService.deleteRoom(code);
  }
}
