import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
  action?: { label: string; run: () => void };
  timeout?: number;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** If set, the user must type this word to confirm. */
  typeToConfirm?: string;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  maxLength?: number;
  resolve: (value: string | null) => void;
}

interface UiState {
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  askText: (req: Omit<PromptRequest, 'resolve'>) => Promise<string | null>;
  settlePrompt: (value: string | null) => void;
  pushToast: (t: Omit<Toast, 'id'>) => number;
  dismissToast: (id: number) => void;
  ask: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  settle: (ok: boolean) => void;
}

let seq = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  confirm: null,
  prompt: null,
  askText: (req) =>
    new Promise<string | null>((resolve) => {
      get().prompt?.resolve(null);
      set({ prompt: { ...req, resolve } });
    }),
  settlePrompt: (value) => {
    const p = get().prompt;
    set({ prompt: null });
    p?.resolve(value);
  },
  pushToast: (t) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    const timeout = t.timeout ?? (t.kind === 'error' ? 8000 : 4200);
    if (timeout > 0) setTimeout(() => get().dismissToast(id), timeout);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  ask: (req) =>
    new Promise<boolean>((resolve) => {
      get().confirm?.resolve(false);
      set({ confirm: { ...req, resolve } });
    }),
  settle: (ok) => {
    const c = get().confirm;
    set({ confirm: null });
    c?.resolve(ok);
  },
}));

export const toast = (text: string, kind: Toast['kind'] = 'info', extra: Partial<Toast> = {}) =>
  useUi.getState().pushToast({ text, kind, ...extra });
export const ask = (req: Omit<ConfirmRequest, 'resolve'>) => useUi.getState().ask(req);
export const askText = (req: Omit<PromptRequest, 'resolve'>) => useUi.getState().askText(req);
