import React, { useEffect } from 'react';

const tones = {
  danger: {
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/10',
    button: 'bg-rose-600 hover:bg-rose-500',
    focus: 'focus:ring-rose-400',
  },
  neutral: {
    border: 'border-white/10',
    bg: 'bg-white/5',
    button: 'bg-sky-600 hover:bg-sky-500',
    focus: 'focus:ring-sky-400',
  },
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'neutral',
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;
  const t = tones[tone] || tones.neutral;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby={description ? 'confirm-description' : undefined}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        onClick={onCancel}
        aria-label="Close dialog"
      />

      <div
        className={`relative w-full max-w-md rounded-2xl border ${t.border} bg-slate-950 shadow-2xl`}
      >
        <div className="p-5">
          <div className={`rounded-xl border ${t.border} ${t.bg} px-4 py-3`}>
            <h2 id="confirm-title" className="text-base font-semibold text-white">
              {title}
            </h2>
            {description ? (
              <p id="confirm-description" className="mt-1 text-sm text-slate-300">
                {description}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-sm"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`px-3 py-2 rounded-lg text-white text-sm font-semibold ${t.button} focus:outline-none focus:ring-2 ${t.focus}`}
              autoFocus
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
