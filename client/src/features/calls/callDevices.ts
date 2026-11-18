export interface CallDevices {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  cameraId: string;
  microphoneId: string;
}

export const DEFAULT_CALL_DEVICES: CallDevices = {
  cameraEnabled: false,
  microphoneEnabled: false,
  cameraId: '',
  microphoneId: '',
};
