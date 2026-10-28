/**
 * Audio device helpers. Browsers expose only device labels — not the transport — so the
 * headphone/Bluetooth/speaker classification below is a best-effort reading of the label and
 * is always presented to the user as such.
 */
export type DeviceKind = 'headphones' | 'bluetooth' | 'speakers' | 'unknown';

export interface DeviceInfo {
  deviceId: string;
  groupId: string;
  label: string;
  kind: DeviceKind;
  isDefault: boolean;
}

const BLUETOOTH = /bluetooth|airpods|\bbuds\b|galaxy buds|pixel buds|beats|\bbose\b|wh-1000|wf-1000|\bjabra\b|hands[- ]?free|\bhfp\b|\ba2dp\b|\bbt\b|\bjbl\b|soundcore|sennheiser momentum|powerbeats/i;
const HEADPHONES = /head ?phone|headset|ear ?phone|earbud|in-ear|airpods|\bbuds\b|line out|usb[- ]?c audio|usb audio|external headphones|casque|écouteurs|kopfhörer|سماعة/i;
const SPEAKERS = /speaker|built-in output|internal speakers|display audio|\bhdmi\b|\btv\b|displayport|monitor|haut-parleur|lautsprecher|مكبر/i;

export function classifyLabel(label: string): DeviceKind {
  if (!label) return 'unknown';
  if (BLUETOOTH.test(label)) return 'bluetooth';
  if (HEADPHONES.test(label)) return 'headphones';
  if (SPEAKERS.test(label)) return 'speakers';
  return 'unknown';
}

/** Chrome lists pseudo-devices such as "Default - Foo" and "Communications - Foo". */
export function cleanLabel(label: string): string {
  return label.replace(/^(Default|Communications)\s*-\s*/i, '').trim();
}

export async function listDevices(): Promise<{ inputs: DeviceInfo[]; outputs: DeviceInfo[]; labelsAvailable: boolean }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [], labelsAvailable: false };
  const all = await navigator.mediaDevices.enumerateDevices();
  const map = (d: MediaDeviceInfo): DeviceInfo => ({
    deviceId: d.deviceId,
    groupId: d.groupId,
    label: d.label,
    kind: classifyLabel(cleanLabel(d.label)),
    isDefault: d.deviceId === 'default' || d.deviceId === '',
  });
  const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications').map(map);
  const outputs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications').map(map);
  return { inputs, outputs, labelsAvailable: all.some((d) => d.label) };
}

export const outputSelectionSupported = (): boolean =>
  typeof AudioContext !== 'undefined' && typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === 'function';
