import { registerSW } from 'virtual:pwa-register';
import { engine } from '../audio/engine';
import { translate } from '../i18n';
import { useSettings } from '../state/settings';
import { toast } from '../state/ui';

/**
 * Offline support. A new version never reloads the page by itself — that could cut a
 * recording short — the user chooses when to update.
 */
export function registerServiceWorker() {
  const lang = () => useSettings.getState().language;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast(translate(lang(), 'pwa.update'), 'info', {
        timeout: 0,
        action: {
          label: translate(lang(), 'pwa.reload'),
          run: () => {
            const r = engine.getState().recording.state;
            if (r === 'recording' || r === 'paused' || r === 'stopping') {
              toast(translate(lang(), 'pwa.finishFirst'), 'warning');
              return;
            }
            void update(true);
          },
        },
      });
    },
    onOfflineReady() {
      toast(translate(lang(), 'about.offlineReady'), 'success');
    },
  });
}
