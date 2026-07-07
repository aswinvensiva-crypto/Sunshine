import { useState, useRef, useEffect } from "react";

/**
 * Drop-in replacement for a Save/Create/Update/Confirm <button>: awaits its
 * onClick, disables itself and ignores re-entrant clicks while the promise
 * is pending, and shows a small spinner next to the label.
 *
 * Carries data-ff-submit by default so Enter-to-next-field (see
 * useChordShortcuts) can find the primary action of a form/modal.
 */
export default function FfSubmitButton({
  onClick,
  children,
  className = "",
  disabled = false,
  spinnerLabel,
  ...rest
}) {
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const handleClick = async (e) => {
    if (busy) return;
    setBusy(true);
    try {
      await onClick?.(e);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`ff-btn ${className}`}
      onClick={handleClick}
      disabled={disabled || busy}
      data-ff-submit=""
      {...rest}
    >
      {busy && <span className="ff-btn-spinner" aria-hidden="true" />}
      {busy && spinnerLabel ? spinnerLabel : children}
    </button>
  );
}
