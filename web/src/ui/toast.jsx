// One toast at a time. Call toast("Copied") from anywhere.
import { useEffect, useState } from 'preact/hooks';

let push = () => {};
export function toast(message, ms = 2400) { push({ message, ms, id: Date.now() }); }

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
      {t && <div class="toast" key={t.id}>{t.message}</div>}
    </div>
  );
}
