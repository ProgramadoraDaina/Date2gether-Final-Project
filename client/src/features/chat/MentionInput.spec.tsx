import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MentionInput } from './MentionInput';

const users = [
  { participantId: '1', userName: 'Ana' },
  { participantId: '2', userName: 'Alex' },
];
function Composer({ send, initial = '' }: { send: () => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <MentionInput
        value={value}
        onChange={setValue}
        inputRef={inputRef}
        users={users}
        placeholder="Mensaje"
        label="Participantes"
      />
      <button type="submit">Enviar</button>
    </form>
  );
}

describe('MentionInput', () => {
  it('selects with arrows and Enter without sending the message', () => {
    const send = jest.fn();
    render(<Composer send={send} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '@' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('@Alex ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it('inserts at the cursor without losing the rest of the message', () => {
    render(<Composer send={jest.fn()} initial="Hola @al seguimos" />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    input.setSelectionRange(8, 8);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole('option', { name: 'Alex' }));
    expect(input).toHaveValue('Hola @Alex seguimos');
  });

  it('Escape dismisses suggestions and ordinary text has no suggestions', () => {
    render(<Composer send={jest.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '@a' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'correo@alex.com' } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
