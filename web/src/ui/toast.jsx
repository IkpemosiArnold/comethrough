// One toast at a time. Call toast("Copied") from anywhere, or toast("Renamed", 5000, { label: "Undo", onClick }).
import { useEffect, useState } from 'preact/hooks';

let push = () => {};
export function toast(message, ms = 2400, action = null) { push({ message, ms, action, id: Date.now() }); }

export function Toaster() {
  const [t, setT] = useState(null);
  useEffect(() => {
    push = setT;
    return () => { push = () => {}; };
  }, []);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => setT(null), t.ms);
    return () => clearTimeout(timer);
  }, [t]);
  return (
    <div aria-live="polite" role="status">
      {t && (
        <div class={`toast${t.action ? ' has-action' : ''}`} key={t.id}>
          {t.message}
          {t.action && <button class="toast-action" onClick={() => { setT(null); t.action.onClick(); }}>{t.action.label}</button>}
        </div>
      )}
    </div>
  );
}
