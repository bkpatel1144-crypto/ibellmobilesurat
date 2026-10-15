import { useEffect, useState } from 'react';
import { Modal, Field } from './ui';
import PartySelect from './PartySelect';
import { sendToRepair } from '../lib/db';
import { today, deviceName } from '../lib/format';
import { useToast } from '../context/ToastContext';

export default function SendRepairModal({ device, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ partyId: null, partyName: '', repairer: '', issue: '', date: today() });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (device) setF({ partyId: null, partyName: '', repairer: '', issue: '', date: today() });
  }, [device]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await sendToRepair({ device, ...f });
      toast('Sent to repair');
      onClose(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(device)} onClose={() => onClose(false)} title="Send to repair" subtitle={device && `${deviceName(device)} · ${device.imei}`}>
      <form onSubmit={submit} className="stack">
        <Field label="Repairer (party)">
          <PartySelect
            value={f.partyId}
            allowEmpty
            emptyLabel="No party (enter name)"
            defaultType="repairer"
            onChange={(p) => setF((x) => ({ ...x, partyId: p?.id || null, partyName: p?.name || '' }))}
          />
        </Field>
        {!f.partyId && (
          <Field label="Repairer name">
            <input className="input" value={f.repairer} onChange={(e) => setF({ ...f, repairer: e.target.value })} />
          </Field>
        )}
        <div className="form-grid">
          <Field label="Problem / work needed">
            <input className="input" value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} />
          </Field>
          <Field label="Sent on">
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
        </div>
        <div className="modal-foot" style={{ marginTop: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Send to repair'}</button>
        </div>
      </form>
    </Modal>
  );
}
