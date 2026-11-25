import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { SkeletonList } from './SkeletonList';

describe('Estados de carga y vacío', () => {
  it('el esqueleto anuncia qué está cargando y dibuja la cantidad de filas pedida', () => {
    const { container } = render(<SkeletonList label="Cargando salas…" rows={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando salas…');
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('el estado vacío muestra título, ayuda y acción', () => {
    render(
      <EmptyState
        title="Todavía no tenés salas como administrador."
        hint="Creá una sala permanente."
        action={<a href="/">Crear una sala</a>}
      />,
    );
    expect(screen.getByText('Todavía no tenés salas como administrador.')).toBeInTheDocument();
    expect(screen.getByText('Creá una sala permanente.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear una sala' })).toHaveAttribute('href', '/');
  });
});
