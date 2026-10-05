interface Props {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  hideCancel?: boolean;
  confirmDisabled?: boolean;
}

/** In-app confirmation. Browser confirm() boxes can be permanently silenced by the user, which would make buttons look dead. */
export default function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, hideCancel, confirmDisabled }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <h2>{title}</h2>
        <div className="modal-line">{children}</div>
        <div className="row-actions">
          <button className="btn primary" onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</button>
          {!hideCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
