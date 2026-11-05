'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import {
  ApiError,
  createRoomEmoji,
  deleteRoomEmoji,
  roomEmojiImageUrl,
  roomEmojiSoundUrl,
  type FreesoundSound,
  type RoomEmoji,
} from '@/lib/api';
import { EmojiPanel } from '@/features/chat/EmojiPanel';
import { FreesoundSearch } from './FreesoundSearch';
import styles from './RoomEmojisDialog.module.css';

const MAX_EMOJIS = 50;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_SOUND_BYTES = 512 * 1024;
const MAX_SOUND_SECONDS = 5;
const NAME_PATTERN = /^[a-z0-9_]{2,32}$/;

interface RoomEmojisDialogProps {
  code: string;
  open: boolean;
  onClose: () => void;
  emojis: RoomEmoji[];
  canManage: boolean;
}

function soundDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    audio.src = url;
  });
}

export function RoomEmojisDialog({
  code,
  open,
  onClose,
  emojis,
  canManage,
}: RoomEmojisDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [section, setSection] = useState<'emojis' | 'sounds'>('emojis');
  const [name, setName] = useState('');
  const [source, setSource] = useState<'image' | 'emoji'>('image');
  const [unicode, setUnicode] = useState<string | null>(null);
  // form.reset() no limpia el estado interno del picker: se lo vuelve a montar con otra key.
  const [pickerKey, setPickerKey] = useState(0);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sound, setSound] = useState<File | null>(null);
  const [soundSource, setSoundSource] = useState<'file' | 'freesound'>('file');
  const [freesoundSound, setFreesoundSound] = useState<FreesoundSound | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function pickImage(file: File | null) {
    setImage(file);
    setImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function resetForm() {
    formRef.current?.reset();
    setName('');
    pickImage(null);
    setUnicode(null);
    setSound(null);
    setFreesoundSound(null);
    setPickerKey((value) => value + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = name.trim().toLowerCase();
    if (!NAME_PATTERN.test(normalized)) {
      setError(t('El nombre debe tener de 2 a 32 caracteres: letras, números o guion bajo'));
      return;
    }
    const isSound = section === 'sounds';
    const fileSound = soundSource === 'file' ? sound : null;
    if (isSound && !fileSound && !(soundSource === 'freesound' && freesoundSound)) {
      setError(t('Agregá un sonido: subí un archivo o elegí uno de Freesound'));
      return;
    }
    if (!isSound && source === 'emoji' && !unicode) {
      setError(t('Elegí un emoji'));
      return;
    }
    if (!isSound && source === 'image' && !image) {
      setError(t('Falta la imagen del emoji'));
      return;
    }
    if (!isSound && image && source === 'image' && image.size > MAX_IMAGE_BYTES) {
      setError(t('La imagen no puede superar los 2 MB'));
      return;
    }
    if (fileSound) {
      if (fileSound.size > MAX_SOUND_BYTES) {
        setError(t('El audio no puede superar los 512 KB'));
        return;
      }
      const seconds = await soundDuration(fileSound).catch(() => Number.NaN);
      if (!(seconds <= MAX_SOUND_SECONDS)) {
        setError(t('El audio no puede durar más de 5 segundos'));
        return;
      }
    }

    const form = new FormData();
    form.append('name', normalized);
    if (!isSound && source === 'image' && image) form.append('image', image);
    if (!isSound && source === 'emoji' && unicode) form.append('emoji', unicode);
    if (fileSound) form.append('sound', fileSound);
    if (soundSource === 'freesound' && freesoundSound) {
      form.append('freesoundId', String(freesoundSound.id));
    }
    setSaving(true);
    try {
      await createRoomEmoji(code, form);
      resetForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('No se pudo agregar el emoji'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    setConfirmingId(null);
    try {
      await deleteRoomEmoji(code, id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('No se pudo borrar el emoji'));
    }
  }

  const visible = emojis.filter((emoji) =>
    section === 'sounds' ? emoji.kind === 'sound' : emoji.kind === 'emoji',
  );

  function play(id: string) {
    void new Audio(roomEmojiSoundUrl(code, id)).play();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="room-emojis-title"
    >
      <header className={styles.header}>
        <h2 id="room-emojis-title">{t('Emojis y sonidos de la sala')}</h2>
        <span className={styles.counter}>
          {emojis.length}/{MAX_EMOJIS}
        </span>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('Cerrar')}>
          ✕
        </button>
      </header>

      <div className={styles.sectionTabs} role="tablist">
        {(['emojis', 'sounds'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className={styles.sourceTab}
            onClick={() => {
              setSection(value);
              setError(null);
            }}
          >
            {value === 'emojis' ? t('Emojis') : t('Sonidos')}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>
          {section === 'emojis'
            ? t('Esta sala todavía no tiene emojis propios.')
            : t(
                'Esta sala todavía no tiene sonidos. Se reproducen desde el botón 🔊 de la llamada.',
              )}
        </p>
      ) : (
        <ul className={styles.grid}>
          {visible.map((emoji) => (
            <li key={emoji.id} className={styles.item}>
              {emoji.kind === 'sound' ? (
                <span className={styles.unicode} aria-hidden="true">
                  🔊
                </span>
              ) : emoji.emoji ? (
                <span className={styles.unicode} aria-hidden="true">
                  {emoji.emoji}
                </span>
              ) : (
                <img src={roomEmojiImageUrl(code, emoji.id)} alt="" width={40} height={40} />
              )}
              <span className={styles.nameBlock}>
                <span className={styles.name} title={`:${emoji.name}:`}>
                  :{emoji.name}:
                </span>
                {emoji.soundAttribution && (
                  <span className={styles.credit} title={emoji.soundAttribution}>
                    🔊 {emoji.soundAttribution}
                  </span>
                )}
              </span>
              {emoji.hasSound && (
                <button
                  type="button"
                  className={styles.iconAction}
                  onClick={() => play(emoji.id)}
                  aria-label={`${t('Escuchar')} :${emoji.name}:`}
                >
                  ▶
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  className={styles.deleteAction}
                  data-confirming={confirmingId === emoji.id}
                  onClick={() => handleDelete(emoji.id)}
                  onBlur={() => setConfirmingId(null)}
                  aria-label={`${t('Borrar')} :${emoji.name}:`}
                >
                  {confirmingId === emoji.id ? t('¿Borrar?') : '✕'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form ref={formRef} className={styles.form} onSubmit={handleSubmit}>
          <h3>{section === 'sounds' ? t('Agregar sonido') : t('Agregar emoji')}</h3>
          <label htmlFor="emoji-name">{t('Nombre')}</label>
          <div className={styles.nameField}>
            <span aria-hidden="true">:</span>
            <input
              id="emoji-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="bruh"
              autoComplete="off"
              required
            />
            <span aria-hidden="true">:</span>
          </div>

          {section === 'emojis' && (
            <>
              <div className={styles.sourceTabs} role="radiogroup" aria-label={t('Apariencia')}>
                {(['image', 'emoji'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={source === value}
                    className={styles.sourceTab}
                    onClick={() => setSource(value)}
                  >
                    {value === 'image' ? t('Subir imagen') : t('Emoji común')}
                  </button>
                ))}
              </div>

              {source === 'image' ? (
                <>
                  <label htmlFor="emoji-image">{t('Imagen (PNG, JPG, WebP o GIF)')}</label>
                  <div className={styles.fileRow}>
                    <input
                      id="emoji-image"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
                    />
                    {imagePreview && <img src={imagePreview} alt="" width={40} height={40} />}
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.selectedEmoji}>
                    {t('Elegido:')} <span>{unicode ?? '—'}</span>
                  </p>
                  <div className={styles.emojiPicker}>
                    <EmojiPanel key={pickerKey} onSelect={setUnicode} />
                  </div>
                </>
              )}
            </>
          )}

          <div className={styles.sourceTabs} role="radiogroup" aria-label={t('Sonido opcional')}>
            {(['file', 'freesound'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={soundSource === value}
                className={styles.sourceTab}
                onClick={() => setSoundSource(value)}
              >
                {value === 'file' ? t('Sonido: subir archivo') : t('Sonido: Freesound')}
              </button>
            ))}
          </div>

          {soundSource === 'file' ? (
            <>
              <label htmlFor="emoji-sound">
                {section === 'sounds'
                  ? t('Sonido (MP3, OGG o WAV, hasta 5 s)')
                  : t('Sonido opcional (MP3, OGG o WAV, hasta 5 s)')}
              </label>
              <input
                id="emoji-sound"
                type="file"
                accept="audio/mpeg,audio/ogg,audio/wav"
                onChange={(e) => setSound(e.target.files?.[0] ?? null)}
              />
            </>
          ) : (
            <FreesoundSearch code={code} selected={freesoundSound} onSelect={setFreesoundSound} />
          )}

          {error && (
            <p className={styles.error} role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" disabled={saving || emojis.length >= MAX_EMOJIS}>
            {saving
              ? t('Subiendo…')
              : section === 'sounds'
                ? t('Agregar sonido')
                : t('Agregar emoji')}
          </button>
        </form>
      ) : (
        <p className={styles.hint}>
          {t('Solo administradores y colaboradores pueden agregar o borrar emojis.')}
        </p>
      )}
    </dialog>
  );
}
