import React, { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Copy, Check, Edit2 } from 'lucide-react';

const REVEAL_TIMEOUT_MS = 15000;

// Secure-by-default input for bearer tokens. Masks the stored value,
// offers one-tap reveal (auto-hides after 15s and on window blur),
// copy-to-clipboard, and an explicit edit/replace affordance.
export default function TokenField({ value, onChange, placeholder, autoFocus = false }) {
  const hasStored = typeof value === 'string' && value.length > 0;
  const [editing, setEditing] = useState(!hasStored);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const revealTimerRef = useRef(null);
  const inputRef = useRef(null);

  // If the stored value is cleared from outside, drop back into edit mode.
  useEffect(() => {
    if (!hasStored && !editing) setEditing(true);
  }, [hasStored, editing]);

  // Auto-hide reveal after timeout or when the window loses focus.
  useEffect(() => {
    if (!revealed) return undefined;
    revealTimerRef.current = setTimeout(() => setRevealed(false), REVEAL_TIMEOUT_MS);
    const onBlur = () => setRevealed(false);
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(revealTimerRef.current);
      window.removeEventListener('blur', onBlur);
    };
  }, [revealed]);

  // Focus the input when entering edit mode so paste works immediately.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const maskedDisplay = hasStored
    ? `${'•'.repeat(Math.min(20, Math.max(0, value.length - 4)))}${value.slice(-4)}`
    : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  };

  const handleEdit = () => {
    setRevealed(false);
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="token-field token-field--editing">
        <input
          ref={inputRef}
          type="password"
          className="token-input"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {hasStored && (
          <button
            type="button"
            className="token-field-btn"
            onClick={() => setEditing(false)}
            title="Cancel edit"
          >
            Done
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="token-field token-field--masked">
      <div className="token-field-value" title={revealed ? value : 'Token is hidden'}>
        {revealed ? value : maskedDisplay}
      </div>
      <button
        type="button"
        className="token-field-btn"
        onClick={() => setRevealed((r) => !r)}
        title={revealed ? 'Hide token' : 'Reveal token (auto-hides in 15s)'}
        aria-label={revealed ? 'Hide token' : 'Reveal token'}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button
        type="button"
        className="token-field-btn"
        onClick={handleCopy}
        title="Copy token to clipboard"
        aria-label="Copy token"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        type="button"
        className="token-field-btn"
        onClick={handleEdit}
        title="Replace token"
        aria-label="Replace token"
      >
        <Edit2 size={14} />
      </button>
    </div>
  );
}
