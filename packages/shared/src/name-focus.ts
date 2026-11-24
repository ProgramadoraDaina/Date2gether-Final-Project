export interface NameFocusState {
  enabled: boolean;
}

export const NAME_FOCUS_EVENTS = {
  set: 'setNameFocus',
  state: 'nameFocusState',
} as const;
