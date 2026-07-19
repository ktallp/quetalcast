import { toast } from '@/components/ui/sonner';

function fallbackCopy(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  if (!ok) throw new Error('copy failed');
}

/**
 * Copy text to the clipboard with a toast on success and a graceful
 * fallback when the Clipboard API is unavailable or blocked.
 */
export async function copyText(text: string, label = 'Link'): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
    toast(`${label} copied`);
    return true;
  } catch {
    try {
      fallbackCopy(text);
      toast(`${label} copied`);
      return true;
    } catch {
      toast.error(`Couldn't copy automatically. ${label}: ${text}`, { duration: 8000 });
      return false;
    }
  }
}
