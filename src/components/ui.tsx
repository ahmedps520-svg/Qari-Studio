import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'danger-solid';

export function Button({
  variant = 'secondary',
  size,
  block,
  icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  size,
  bordered,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm'; bordered?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${size ?? ''} ${bordered ? 'bordered' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: 'lg';
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${size ?? ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  icon,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  icon?: ReactNode;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const text = format ? format(value) : String(value);
  return (
    <div className="slider">
      <label className="slider-label" htmlFor={id}>
        {icon}
        {label}
      </label>
      <output className="slider-value" htmlFor={id}>
        {text}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="faint" style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-xs)' }}>{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({
  kind = 'info',
  children,
  actions,
  icon,
}: {
  kind?: 'info' | 'warn' | 'error' | 'ok';
  children: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  const I = kind === 'warn' ? AlertTriangle : kind === 'error' ? XCircle : kind === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`notice ${kind}`} role={kind === 'error' || kind === 'warn' ? 'alert' : 'status'}>
      {icon ?? <I />}
      <div className="grow">
        {children}
        {actions && <div className="notice-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bottom sheet on phones, centred dialog on larger screens. Traps focus; Esc closes. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  width,
  labelledBy,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'wide' | 'narrow';
  labelledBy?: string;
  dismissable?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const restore = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      restore.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, dismissable]);

  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose();
      }}
    >
      <div
        ref={ref}
        className={`sheet ${width ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        dir={t.dir}
      >
        {title !== undefined && (
          <div className="sheet-head">
            <h2 id={titleId} className="sheet-title grow">
              {title}
            </h2>
            {dismissable && (
              <IconButton label={t('common.close')} onClick={onClose} size="sm" bordered>
                <X />
              </IconButton>
            )}
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Dropdown menu anchored to a trigger button. */
export function Menu({
  label,
  trigger,
  items,
  align = 'end',
}: {
  label: string;
  trigger: ReactNode;
  items: ({ label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'sep')[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const side = align === 'end' ? { insetInlineEnd: 0 } : { insetInlineStart: 0 };
  return (
    <div ref={wrap} style={{ position: 'relative' }} dir={t.dir}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div ref={menuRef} className="menu" role="menu" style={{ top: '100%', marginTop: 6, ...side }}>
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={`sep-${i}`} />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={it.danger ? 'danger' : ''}
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function OptionList<T extends string>({
  value,
  onChange,
  options,
  label,
  cols,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; sub?: string; disabled?: boolean; aside?: ReactNode }[];
  label: string;
  cols?: 2;
}) {
  return (
    <div className={`options ${cols === 2 ? 'cols-2' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          className="option"
          onClick={() => onChange(o.value)}
        >
          <span className="radio" />
          <span className="grow">
            <span className="opt-title" style={{ display: 'block' }}>
              {o.title}
            </span>
            {o.sub && (
              <span className="opt-sub" style={{ display: 'block' }}>
                {o.sub}
              </span>
            )}
          </span>
          {o.aside}
        </button>
      ))}
    </div>
  );
}
