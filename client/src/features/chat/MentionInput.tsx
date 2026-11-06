'use client';

import { useId, useState, type RefObject } from 'react';
import { getMentionQuery } from './mentions';
import styles from './MentionInput.module.css';

interface Props {
  value: string;
  onChange(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  users: readonly { participantId: string; userName: string }[];
  placeholder: string;
  label: string;
}

export function MentionInput({ value, onChange, inputRef, users, placeholder, label }: Props) {
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const match = dismissed ? null : getMentionQuery(value, Math.min(caret, value.length));
  const suggestions = match
    ? users.filter((user) => user.userName.toLocaleLowerCase().includes(match.query))
    : [];
  const selectedIndex = suggestions.length ? activeIndex % suggestions.length : 0;
  const open = suggestions.length > 0;

  function insert(name: string) {
    if (!match) return;
    const suffix = value.slice(match.end);
    const inserted = '@' + name + (/^\s/u.test(suffix) ? '' : ' ');
    onChange(value.slice(0, match.start) + inserted + value.slice(match.end));
    const nextCaret = match.start + inserted.length;
    setCaret(nextCaret);
    setDismissed(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  return (
    <div className={styles.composerWrap}>
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? listId + '-' + selectedIndex : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setDismissed(false);
          setActiveIndex(0);
        }}
        onSelect={(event) => {
          const next = event.currentTarget.selectionStart ?? value.length;
          if (next !== caret) {
            setCaret(next);
            setDismissed(false);
            setActiveIndex(0);
          }
        }}
        onFocus={() => setDismissed(false)}
        onBlur={() => setDismissed(true)}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(
              (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                suggestions.length,
            );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            insert(suggestions[selectedIndex].userName);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDismissed(true);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <ul id={listId} className={styles.mentionSuggestions} role="listbox" aria-label={label}>
          {suggestions.map((user, index) => (
            <li key={user.participantId} role="presentation">
              <button
                id={listId + '-' + index}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(user.userName)}
              >
                {user.userName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
