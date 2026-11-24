import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import type { Participant } from 'livekit-client';
import { AvatarDirectoryProvider } from './AvatarDirectory';
import { TileAvatar } from './TileAvatar';

jest.mock('@livekit/components-react', () => ({
  useIsSpeaking: (participant: { isSpeaking: boolean }) => participant.isSpeaking,
}));

describe('TileAvatar', () => {
  it('dibuja el avatar de esa persona en el placeholder de LiveKit y habla solo cuando habla', () => {
    const placeholder = document.createElement('div');
    document.body.append(placeholder);
    const directory = new Map([['p-1', { head: ['egg' as const], sticker: true }]]);
    const tile = (isSpeaking: boolean) => (
      <AvatarDirectoryProvider directory={directory}>
        <TileAvatar
          participant={{ identity: 'p-1', isSpeaking } as Participant}
          placeholder={placeholder}
        />
      </AvatarDirectoryProvider>
    );

    const { rerender } = render(tile(false));
    const figure = () => placeholder.querySelector('[data-testid="avatar-figure"]');
    expect(figure()?.querySelector('[data-piece="egg"]')).not.toBeNull();
    expect(figure()).not.toHaveAttribute('data-speaking');

    rerender(tile(true));
    expect(figure()).toHaveAttribute('data-speaking');
  });

  it('en una mini sala (identity nueva) muestra el avatar de la persona usando la identity de origen', () => {
    const placeholder = document.createElement('div');
    document.body.append(placeholder);
    const directory = new Map([['p-1', { head: ['egg' as const], sticker: true }]]);
    render(
      <AvatarDirectoryProvider directory={directory}>
        <TileAvatar
          participant={
            {
              identity: 'minted-uuid',
              metadata: JSON.stringify({ sourceIdentity: 'p-1' }),
              isSpeaking: false,
            } as unknown as Participant
          }
          placeholder={placeholder}
        />
      </AvatarDirectoryProvider>,
    );

    expect(placeholder.querySelector('[data-piece="egg"]')).not.toBeNull();
  });
});
