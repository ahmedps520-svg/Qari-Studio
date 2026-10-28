import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { Button, IconButton, Sheet } from './ui';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const t = useT();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((x) => {
        const I = x.kind === 'success' ? CheckCircle2 : x.kind === 'warning' ? AlertTriangle : x.kind === 'error' ? XCircle : Info;
        return (
          <div key={x.id} className={`toast ${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'} dir={t.dir}>
            <I />
            <span className="grow">{x.text}</span>
            {x.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  x.action!.run();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
            <IconButton label={t('common.dismiss')} onClick={() => dismiss(x.id)}>
              <X />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmDialog() {
  const req = useUi((s) => s.confirm);
  const settle = useUi((s) => s.settle);
  const t = useT();
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [req]);
  if (!req) return null;
  const blocked = req.typeToConfirm ? typed.trim() !== req.typeToConfirm : false;
  return (
    <Sheet
      open
      onClose={() => settle(false)}
      title={req.title}
      width="narrow"
      footer={
        <>
          <Button variant="secondary" onClick={() => settle(false)}>
            {req.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={req.danger ? 'danger-solid' : 'primary'} disabled={blocked} onClick={() => settle(true)} data-testid="confirm-ok">
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      {req.body && <p className="muted">{req.body}</p>}
      {req.typeToConfirm && (
        <input
          className="input"
          style={{ marginTop: 16 }}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={req.typeToConfirm}
          placeholder={req.typeToConfirm}
          autoComplete="off"
          data-autofocus
        />
      )}
    </Sheet>
  );
}

export function PromptDialog() {
  const req = useUi((s) => s.prompt);
  const settle = useUi((s) => s.settlePrompt);
  const t = useT();
  const [value, setValue] = useState('');
  useEffect(() => setValue(req?.initial ?? ''), [req]);
  if (!req) return null;
  const ok = value.trim().length > 0;
  return (
    <Sheet
      open
      onClose={() => settle(null)}
      title={req.title}
      width="narrow"
      footer={
        <>
          <Button variant="secondary" onClick={() => settle(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!ok} onClick={() => settle(value.trim())} data-testid="prompt-ok">
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) settle(value.trim());
        }}
      >
        <label className="field">
          <span className="field-label">{req.label}</span>
          <input
            className="input"
            value={value}
            maxLength={req.maxLength ?? 120}
            onChange={(e) => setValue(e.target.value)}
            data-autofocus
            onFocus={(e) => e.currentTarget.select()}
            data-testid="prompt-input"
          />
        </label>
      </form>
    </Sheet>
  );
}
