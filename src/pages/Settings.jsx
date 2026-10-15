import { useEffect, useRef, useState } from 'react';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { Save, Upload, Trash2, Smartphone, Sun, Moon, Monitor, KeyRound } from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/Layout';
import { Field, Segmented } from '../components/ui';
import PasskeyModal from '../components/PasskeyModal';
import LabelPreview from '../components/LabelPreview';
import { labelLayout, LABEL_FONT_DEFAULTS } from '../lib/labels';
import { saveSettings, maxNumber } from '../lib/db';
import { fileToLogo } from '../lib/files';
import { getTheme, setTheme } from '../lib/theme';

const FIELDS = [
  'shopName', 'tagline', 'address', 'phone', 'email', 'gstin', 'logo',
  'invoicePrefix', 'cashInvoicePrefix', 'purchasePrefix', 'defaultTax', 'defaultWarranty', 'invoiceTerms', 'invoiceFooter',
  'snPrefix', 'snNext', 'labelWidth', 'labelHeight', 'labelShowBattery', 'autoPrintLabels',
  'labelTitlePt', 'labelCodePt', 'labelInfoPt', 'labelShowWarranty',
];

const SAMPLE_DEVICE = { brand: 'Apple', model: 'iPhone 15 Pro', variant: '256', color: 'White', imei: '355262965973925', battery: 95, warranty: '6 Months' };

export default function Settings() {
  const { settings, privacy, raw } = useData();
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(() => pick(settings));
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState(getTheme());
  const [changingKey, setChangingKey] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const logoInput = useRef();
  const dirty = useRef(false);

  // follow live changes from other devices until the user starts editing
  useEffect(() => {
    if (!dirty.current) setF(pick(settings));
  }, [settings]);

  const touched = useRef(new Set());
  const set = (k) => (e) => {
    dirty.current = true;
    touched.current.add(k);
    setF((p) => ({ ...p, [k]: e.target.value }));
  };

  const setBool = (k) => (e) => {
    dirty.current = true;
    setF((p) => ({ ...p, [k]: e.target.checked }));
  };

  // highest SN already given with the prefix being typed - the next number must be above it
  const snUsed = maxNumber(raw.devices.map((d) => d.sn), f.snPrefix || '');
  const previewDevice = { ...SAMPLE_DEVICE, sn: `${f.snPrefix || ''}${Math.floor(Number(f.snNext)) || 1}` };

  const save = async (e) => {
    e.preventDefault();
    if (!f.shopName.trim()) return toast('Shop name is required', 'error');
    const snChanged = touched.current.has('snNext') || touched.current.has('snPrefix');
    const snNext = Math.floor(Number(f.snNext)) || 1;
    if (snChanged && snNext <= snUsed) return toast(`Next SN must be more than ${f.snPrefix}${snUsed} (already used)`, 'error');
    setBusy(true);
    try {
      const data = {
        ...f,
        defaultTax: Number(f.defaultTax) || 0,
        snPrefix: (f.snPrefix || '').trim(),
        snNext,
        labelWidth: Number(f.labelWidth) || 50,
        labelHeight: Number(f.labelHeight) || 25,
        labelTitlePt: Number(f.labelTitlePt) || LABEL_FONT_DEFAULTS.labelTitlePt,
        labelCodePt: Number(f.labelCodePt) || LABEL_FONT_DEFAULTS.labelCodePt,
        labelInfoPt: Number(f.labelInfoPt) || LABEL_FONT_DEFAULTS.labelInfoPt,
      };
      // the SN counter moves on every purchase - only write it when it was edited here
      if (!snChanged) delete data.snNext;
      await saveSettings(data);
      touched.current.clear();
      dirty.current = false;
      toast('Settings saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onLogo = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const logo = await fileToLogo(file);
      dirty.current = true;
      setF((p) => ({ ...p, logo }));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 6) return toast('New password must be at least 6 characters', 'error');
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw.current));
      await updatePassword(user, pw.next);
      setPw({ current: '', next: '' });
      toast('Password changed');
    } catch (err) {
      toast(err.code === 'auth/invalid-credential' ? 'Current password is wrong' : err.message, 'error');
    }
  };

  return (
    <div className="page">
      <form onSubmit={save}>
        <PageHeader
          title="Settings"
          subtitle="Shop details, bill format and app preferences"
          actions={
            <button className="btn btn-primary" disabled={busy}>
              <Save size={16} /> {busy ? 'Saving…' : 'Save'}
            </button>
          }
        />
        <div className="stack">
          <section className="card card-lg">
            <div className="card-head"><h2>Shop profile</h2></div>
            <div className="row" style={{ gap: 16, marginBottom: 20, alignItems: 'center' }}>
              <div className="brand-logo" style={{ width: 80, height: 80, borderRadius: 22 }}>
                {f.logo ? <img src={f.logo} alt="Shop logo" /> : <Smartphone size={34} />}
              </div>
              <div className="stack-sm">
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => logoInput.current.click()}><Upload size={15} /> Upload logo</button>
                  {f.logo && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => { dirty.current = true; setF({ ...f, logo: '' }); }}>
                      <Trash2 size={15} /> Remove
                    </button>
                  )}
                </div>
                <span className="xs muted">Square image works best. Printed on every bill and report.</span>
              </div>
              <input ref={logoInput} type="file" accept="image/*" hidden onChange={onLogo} />
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              <Field label="Shop name" required><input className="input" value={f.shopName} onChange={set('shopName')} /></Field>
              <Field label="Tagline"><input className="input" value={f.tagline} onChange={set('tagline')} /></Field>
              <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
              <Field label="E-mail"><input className="input" value={f.email} onChange={set('email')} /></Field>
              <Field label="GSTIN"><input className="input mono" value={f.gstin} onChange={set('gstin')} /></Field>
            </div>
            <Field label="Address" style={{ marginTop: 12 }}>
              <textarea className="textarea" rows={2} value={f.address} onChange={set('address')} />
            </Field>
          </section>

          <section className="card card-lg">
            <div className="card-head"><h2>Bill & numbering</h2></div>
            <div className="form-grid">
              <Field label="Invoice prefix" hint="e.g. INV- → INV-0001"><input className="input mono" value={f.invoicePrefix} onChange={set('invoicePrefix')} /></Field>
              {privacy.unlocked && (
                <Field label="Private bill prefix" hint="Separate series for private sales"><input className="input mono" value={f.cashInvoicePrefix} onChange={set('cashInvoicePrefix')} /></Field>
              )}
              <Field label="Purchase prefix"><input className="input mono" value={f.purchasePrefix} onChange={set('purchasePrefix')} /></Field>
              <Field label="Default GST %"><input className="input num" type="number" min="0" step="0.01" value={f.defaultTax} onChange={set('defaultTax')} /></Field>
              <Field label="Default warranty (used phones)"><input className="input" value={f.defaultWarranty} onChange={set('defaultWarranty')} placeholder="e.g. 7 days checking warranty" /></Field>
            </div>
            <Field label="Terms & conditions (printed on bill)" style={{ marginTop: 12 }}>
              <textarea className="textarea" rows={4} value={f.invoiceTerms} onChange={set('invoiceTerms')} />
            </Field>
            <Field label="Bill footer line" style={{ marginTop: 12 }}>
              <input className="input" value={f.invoiceFooter} onChange={set('invoiceFooter')} />
            </Field>
          </section>

          <section className="card card-lg">
            <div className="card-head">
              <div>
                <h2>Device SN & barcode labels</h2>
                <p className="muted small" style={{ margin: 0 }}>Every device you buy gets the next SN automatically</p>
              </div>
            </div>
            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <div className="stack">
                <div className="form-grid">
                  <Field label="SN prefix" hint="e.g. G- → G-523">
                    <input className="input mono" value={f.snPrefix} onChange={set('snPrefix')} />
                  </Field>
                  <Field label="Next SN number" hint={snUsed ? `Last used: ${f.snPrefix}${snUsed}` : 'No SN used yet with this prefix'}>
                    <input className="input num" type="number" min="1" step="1" value={f.snNext} onChange={set('snNext')} />
                  </Field>
                  <Field label="Label width (mm)">
                    <input className="input num" type="number" min="25" max="120" value={f.labelWidth} onChange={set('labelWidth')} />
                  </Field>
                  <Field label="Label height (mm)">
                    <input className="input num" type="number" min="12" max="80" value={f.labelHeight} onChange={set('labelHeight')} />
                  </Field>
                </div>
                <div className="field-label">Text size on label (pt)</div>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', marginTop: -8 }}>
                  <Field label="Model line">
                    <input className="input num" type="number" min="5" max="24" step="0.5" value={f.labelTitlePt} onChange={set('labelTitlePt')} />
                  </Field>
                  <Field label="IMEI number">
                    <input className="input num" type="number" min="5" max="24" step="0.5" value={f.labelCodePt} onChange={set('labelCodePt')} />
                  </Field>
                  <Field label="SN / BH / Warranty">
                    <input className="input num" type="number" min="5" max="24" step="0.5" value={f.labelInfoPt} onChange={set('labelInfoPt')} />
                  </Field>
                </div>
                <label className="check small">
                  <input type="checkbox" checked={f.labelShowWarranty !== false} onChange={setBool('labelShowWarranty')} />
                  Print warranty on label
                </label>
                <label className="check small">
                  <input type="checkbox" checked={f.labelShowBattery !== false} onChange={setBool('labelShowBattery')} />
                  Print battery health (BH) on label
                </label>
                <label className="check small">
                  <input type="checkbox" checked={Boolean(f.autoPrintLabels)} onChange={setBool('autoPrintLabels')} />
                  Print labels automatically after saving a purchase
                </label>
              </div>
              <div className="stack-sm" style={{ alignItems: 'flex-start' }}>
                <span className="field-label">Preview</span>
                <LabelPreview device={previewDevice} settings={f} />
                {labelLayout(previewDevice, f).tooTight && (
                  <span className="chip caution">Text is too big for this label - the barcode is getting too short to scan</span>
                )}
                <span className="xs muted">Set your label printer's paper size to {f.labelWidth || 50} × {f.labelHeight || 25} mm.</span>
              </div>
            </div>
          </section>
        </div>
      </form>

      <div className="stack" style={{ marginTop: 16 }}>
        <section className="card card-lg">
          <div className="card-head"><h2>Appearance</h2></div>
          <Segmented
            label="Theme"
            value={theme}
            onChange={(v) => {
              setTheme(v);
              setThemeState(v);
            }}
            options={[
              { value: 'system', label: <><Monitor size={14} /> System</> },
              { value: 'light', label: <><Sun size={14} /> White</> },
              { value: 'dark', label: <><Moon size={14} /> Black</> },
            ]}
          />
        </section>

        <section className="card card-lg">
          <div className="card-head"><h2>Account</h2></div>
          <p className="small muted" style={{ marginTop: 0 }}>Signed in as <b>{user?.email}</b></p>
          <form onSubmit={changePassword} className="form-grid" style={{ alignItems: 'end' }}>
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <button className="btn" disabled={!pw.current || !pw.next}>Change password</button>
          </form>
        </section>

        {privacy.unlocked && (
          <section className="card card-lg">
            <div className="card-head"><h2>Passkey</h2></div>
            <p className="small muted" style={{ marginTop: 0 }}>Used to open the private view. Tap the logo 5 times to lock or unlock.</p>
            <button className="btn" onClick={() => setChangingKey(true)}><KeyRound size={16} /> Change passkey</button>
          </section>
        )}
      </div>
      <PasskeyModal open={changingKey} forceSet onClose={(ok) => { setChangingKey(false); if (ok) toast('Passkey changed'); }} />
    </div>
  );
}

function pick(s) {
  const o = {};
  for (const k of FIELDS) o[k] = s[k] ?? '';
  return o;
}
