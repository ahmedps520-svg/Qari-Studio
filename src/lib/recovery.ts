import { computePeaks } from '../audio/dsp/peaks';
import { listRecordings, loadAudio, patchRecording } from './db';

/**
 * A take whose metadata still says "recording" was interrupted (tab closed, crash, power loss).
 * Its audio chunks were written continuously, so rebuild its duration and waveform and keep it
 * as an unsaved draft for the user to review.
 */
export async function recoverInterruptedRecordings(): Promise<number> {
  const all = await listRecordings();
  let n = 0;
  for (const r of all) {
    if (r.status !== 'recording') continue;
    const samples = await loadAudio(r.audioId);
    await patchRecording(r.id, {
      status: 'draft',
      frames: samples.length,
      duration: samples.length / r.sampleRate,
      peaks: computePeaks(samples),
      updatedAt: Date.now(),
    });
    n++;
  }
  return n;
}
