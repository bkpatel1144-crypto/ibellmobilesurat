import { useCallback, useState } from 'react';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { ensureSerials } from './db';

/** Returns [print(devices), busy]. Devices without an SN (bought before SNs existed) get one first. */
export function useLabels() {
  const { settings, raw } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const print = useCallback(
    async (devices) => {
      setBusy(true);
      try {
        const withSn = await ensureSerials(devices, settings, raw.devices);
        const { printLabels } = await import('./labels');
        await printLabels(withSn, settings);
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
