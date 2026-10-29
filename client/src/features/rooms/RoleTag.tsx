import type { RoomRole } from '@/lib/api';
import styles from './RoleTag.module.css';

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
  // Solo "administrador" tiene una variante de color propia (roleTagAdministrador);
  // el resto de los roles usa únicamente el estilo base, igual que antes.
  const variantClass = styles[`roleTag${role.charAt(0).toUpperCase()}${role.slice(1)}`] ?? '';
  return (
    <abbr title={full} className={`${styles.roleTag} ${variantClass}`}>
      {short}
    </abbr>
  );
}
