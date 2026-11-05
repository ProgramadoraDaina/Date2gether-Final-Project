'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import {
  ApiError,
  createRoomEmoji,
  deleteRoomEmoji,
  roomEmojiImageUrl,
  roomEmojiSoundUrl,
  updateRoomEmoji,
  type FreesoundSound,
  type RoomEmoji,
  type StickerOptions,
} from '@/lib/api';
import { EmojiPanel } from '@/features/chat/EmojiPanel';
import { FreesoundSearch } from './FreesoundSearch';
import { StickerOptionsFields } from './StickerOptionsFields';
import styles from './RoomEmojisDialog.module.css';

const MAX_EMOJIS = 50;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_SOUND_BYTES = 512 * 1024;
const MAX_SOUND_SECONDS = 5;
const NAME_PATTERN = /^[a-z0-9_]{2,32}$/;
const DEFAULT_STICKER: StickerOptions = {
  duration: 10,
  position: 'top-right',
  size: 'medium',
  animation: 'static',
};

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
  const [callMode, setCallMode] = useState<RoomEmoji['callMode']>('reaction');
  const [stickerOptions, setStickerOptions] = useState<StickerOptions>(DEFAULT_STICKER);
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
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoomEmoji | null>(null);
  const [removeSound, setRemoveSound] = useState(false);

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
    setEditing(null);
    setRemoveSound(false);
    setCallMode('reaction');
    setStickerOptions(DEFAULT_STICKER);
  }

  function startEdit(emoji: RoomEmoji) {
    resetForm();
    setEditing(emoji);
    setSection(emoji.kind === 'sound' ? 'sounds' : 'emojis');
    setName(emoji.name);
    setSource(emoji.emoji ? 'emoji' : 'image');
    setUnicode(emoji.emoji);
    setCallMode(emoji.callMode);
    setStickerOptions(emoji.sticker);
    setError(null);
    formRef.current?.scrollIntoView({ block: 'start' });
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
    const keepsSound = Boolean(editing?.hasSound) && !removeSound;
    if (isSound && !keepsSound && !fileSound && !(soundSource === 'freesound' && freesoundSound)) {
      setError(t('Agregá un sonido: subí un archivo o elegí uno de Freesound'));
      return;
    }
    if (!isSound && source === 'emoji' && !unicode) {
      setError(t('Elegí un emoji'));
      return;
    }
    const hadImage = Boolean(editing && editing.kind === 'emoji' && !editing.emoji);
    if (!isSound && source === 'image' && !image && !hadImage) {
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
    if (!isSound && source === 'emoji' && unicode && unicode !== editing?.emoji) {
      form.append('emoji', unicode);
    }
    if (!isSound) {
      form.append('callMode', callMode);
      if (callMode === 'sticker') {
        form.append('stickerDuration', String(stickerOptions.duration));
        form.append('stickerPosition', stickerOptions.position);
        form.append('stickerSize', stickerOptions.size);
        form.append('stickerAnimation', stickerOptions.animation);
      }
    }
    if (fileSound) form.append('sound', fileSound);
    if (soundSource === 'freesound' && freesoundSound) {
      form.append('freesoundId', String(freesoundSound.id));
    }
    const replacesSound = Boolean(fileSound) || (soundSource === 'freesound' && freesoundSound);
    if (editing && removeSound && !replacesSound) form.append('removeSound', 'true');
    setSaving(true);
    try {
      if (editing) await updateRoomEmoji(code, editing.id, form);
      else await createRoomEmoji(code, form);
      const label = editing
        ? isSound
          ? t('Sonido actualizado')
          : t('Emoji actualizado')
        : isSound
          ? t('Sonido agregado')
          : t('Emoji agregado');
      setSuccess(`${label}: :${normalized}:`);
      resetForm();
    } catch (err) {
      const fallback = editing ? t('No se pudo guardar el emoji') : t('No se pudo agregar el emoji');
      setError(err instanceof ApiError ? err.message : fallback);
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

  function play(emoji: RoomEmoji) {
    void new Audio(roomEmojiSoundUrl(code, emoji)).play();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      // Un click en el backdrop llega con el propio <dialog> como target: se cierra al tocar afuera.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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

      {success && (
        <p className={styles.success} role="status">
          ✓ {success}
        </p>
      )}

      <div className={styles.sectionTabs} role="tablist">
        {(['emojis', 'sounds'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className={styles.sourceTab}
            onClick={() => {
              if (editing) resetForm();
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
        // Colapsada por defecto: con muchos emojis, el formulario de crear queda a la vista.
        <details className={styles.listToggle}>
          <summary>
            {section === 'emojis'
              ? `${t('Ver emojis de la sala')} (${visible.length})`
              : `${t('Ver sonidos de la sala')} (${visible.length})`}
          </summary>
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
                  <img src={roomEmojiImageUrl(code, emoji)} alt="" width={40} height={40} />
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
                    onClick={() => play(emoji)}
                    aria-label={`${t('Escuchar')} :${emoji.name}:`}
                  >
                    ▶
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    className={styles.iconAction}
                    aria-pressed={editing?.id === emoji.id}
                    onClick={() => startEdit(emoji)}
                    aria-label={`${t('Editar')} :${emoji.name}:`}
                    title={t('Editar')}
                  >
                    ✎
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
        </details>
      )}

      {canManage ? (
        <form ref={formRef} className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formHeading}>
            <h3>
              {editing
                ? `${t('Editando')} :${editing.name}:`
                : section === 'sounds'
                  ? t('Agregar sonido')
                  : t('Agregar emoji')}
            </h3>
            {editing && (
              <button type="button" className={styles.cancelEdit} onClick={resetForm}>
                {t('Cancelar edición')}
              </button>
            )}
          </div>
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
                  <label htmlFor="emoji-image">
                    {editing && !editing.emoji
                      ? t('Imagen nueva (opcional: si no, se mantiene la actual)')
                      : t('Imagen (PNG, JPG, WebP o GIF)')}
                  </label>
                  <div className={styles.fileRow}>
                    <input
                      id="emoji-image"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
                    />
                    {imagePreview ? (
                      <img src={imagePreview} alt="" width={40} height={40} />
                    ) : (
                      editing?.kind === 'emoji' &&
                      !editing.emoji && (
                        <img src={roomEmojiImageUrl(code, editing)} alt="" width={40} height={40} />
                      )
                    )}
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

              <div className={styles.sourceTabs} role="radiogroup" aria-label={t('En la llamada')}>
                {(['reaction', 'sticker'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={callMode === value}
                    className={styles.sourceTab}
                    onClick={() => setCallMode(value)}
                  >
                    {value === 'reaction'
                      ? t('En la llamada: reacción')
                      : t('En la llamada: sticker')}
                  </button>
                ))}
              </div>
              {callMode === 'sticker' && (
                <StickerOptionsFields value={stickerOptions} onChange={setStickerOptions} />
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

          {editing?.hasSound && section === 'emojis' && (
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={removeSound}
                onChange={(e) => setRemoveSound(e.target.checked)}
              />
              {t('Quitar el sonido actual')}
            </label>
          )}
          {editing?.hasSound && (
            <p className={styles.hint}>
              {t('Si no elegís un sonido nuevo, se mantiene el actual.')}
            </p>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" disabled={saving || (!editing && emojis.length >= MAX_EMOJIS)}>
            {saving
              ? t('Subiendo…')
              : editing
                ? t('Guardar cambios')
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
