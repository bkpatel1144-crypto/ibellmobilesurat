import { useCallback, useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { ensureSerials } from './db';

/**
 * Returns [print(devices, extra), busy]. Devices without an SN (bought before SNs existed) get one first.
 * extra: ready-made labels (accessories) printed after the phones, untouched.
 */
export function useLabels() {
  const { settings, raw } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const print = useCallback(
    async (devices, extra = []) => {
      setBusy(true);
      try {
        const withSn = devices.length ? await ensureSerials(devices, settings, raw.devices) : [];
        const { printLabels } = await import('./labels');
        await printLabels([...withSn, ...extra], settings);
      } catch (e) {
        toast(e.message || 'Could not print labels', 'error');
      } finally {
        setBusy(false);
      }
    },
    [settings, raw.devices, toast],
  );

  return [print, busy];
}
