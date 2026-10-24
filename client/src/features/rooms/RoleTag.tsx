import type { RoomRole } from '@/lib/api';

const ROLE_LABELS: Record<RoomRole, { short: string; full: string }> = {
  administrador: { short: 'admin', full: 'Administrador' },
  colaborador: { short: 'colab', full: 'Colaborador' },
  participante: { short: 'part', full: 'Participante' },
};

interface RoleTagProps {
  role: RoomRole;
}

export function RoleTag({ role }: RoleTagProps) {
  // Fallback defensivo: si el backend agrega un rol que el cliente todavía
  // no conoce, se muestra tal cual en vez de romper el render de la sala.
  const { short, full } = ROLE_LABELS[role] ?? { short: role, full: role };
  return (
    <abbr title={full} className={`role-tag role-tag-${role}`}>
      {short}
    </abbr>
  );
}
