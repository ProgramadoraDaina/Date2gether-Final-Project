import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { MessageText } from './MessageText';
import type { RoomEmoji } from '@/lib/api';

describe('MessageText with mentions', () => {
  it('renders mentions alongside room emojis', () => {
    const emoji = {
      id: 'emoji-1',
      name: 'saludo',
      kind: 'emoji',
      emoji: '\u{1F44B}',
      hasSound: false,
    } as RoomEmoji;
    const { container } = render(
      <MessageText
        text="Hola @Ana :saludo:"
        roomCode="abc"
        mentionNames={['Ana']}
        emojisByName={new Map([['saludo', emoji]])}
      />,
    );
    expect(container.querySelector('mark')).toHaveTextContent('@Ana');
    expect(screen.getByTitle(':saludo:')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(':saludo:');
  });
});
