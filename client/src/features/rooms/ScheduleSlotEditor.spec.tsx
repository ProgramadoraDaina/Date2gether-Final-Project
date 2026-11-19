import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('../translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

describe('ScheduleSlotEditor', () => {
  it('agrega un slot válido y lo refleja en la lista mediante onChange', async () => {
    const onChange = jest.fn();
    const { ScheduleSlotEditor } = await import('./ScheduleSlotEditor');
    render(<ScheduleSlotEditor slots={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar horario' }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ dayOfWeek: 1, timeOfDay: '07:00' }),
    ]);
  });

  it('toma la zona horaria de la PC sin pedirla y usa un input de hora', async () => {
    const onChange = jest.fn();
    const { ScheduleSlotEditor } = await import('./ScheduleSlotEditor');
    render(<ScheduleSlotEditor slots={[]} onChange={onChange} />);

    expect(screen.queryByLabelText('Zona horaria')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hora')).toHaveAttribute('type', 'time');

    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '21:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar horario' }));

    expect(onChange).toHaveBeenCalledWith([
      {
        dayOfWeek: 1,
        timeOfDay: '21:30',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ]);
  });

  it('quita un slot existente', async () => {
    const onChange = jest.fn();
    const slots = [{ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' }];
    const { ScheduleSlotEditor } = await import('./ScheduleSlotEditor');
    render(<ScheduleSlotEditor slots={slots} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar horario' }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('rechaza un formato de hora inválido antes de llamar a onChange', async () => {
    const onChange = jest.fn();
    const { ScheduleSlotEditor } = await import('./ScheduleSlotEditor');
    render(<ScheduleSlotEditor slots={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '7:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar horario' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'La hora debe tener el formato HH:MM (24 horas).',
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
