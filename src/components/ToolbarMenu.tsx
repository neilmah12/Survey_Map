import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shown on hover, and the way to say why an item is unavailable. */
  title?: string;
  danger?: boolean;
  /** A thin line above this item, to set a group apart. */
  dividerBefore?: boolean;
}

/**
 * A button that opens a short list of actions. Opens on click, closes on a choice, on Escape, or on a click
 * elsewhere. The arrow keys move through the items, so it works without a mouse.
 */
export default function ToolbarMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const enabled = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  return (
    <div
      className="menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close(true);
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
          e.preventDefault();
          const all = enabled();
          const at = all.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
          all[next]?.focus();
        } else if (e.key === 'ArrowDown' && !open) {
          e.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => enabled()[0]?.focus());
        }
      }}
    >
      <button ref={trigger} className="btn menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label}>
          {items.map((it) => (
            <div key={it.label}>
              {it.dividerBefore && <div className="menu-rule" role="separator" />}
              <button
                role="menuitem"
                className={it.danger ? 'menu-item danger' : 'menu-item'}
                disabled={it.disabled}
                title={it.title}
                onClick={() => {
                  close(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
