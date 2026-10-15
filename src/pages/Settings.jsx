import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import {
  Save,
  Upload,
  Trash2,
  Smartphone,
  Sun,
  Moon,
  Monitor,
  KeyRound,
  Store,
  Receipt,
  Barcode,
  Palette,
  PanelLeft,
  Table,
  ShieldCheck,
  RotateCcw,
  Check,
  LogOut,
  Paintbrush,
  Pipette,
  CircleCheck,
  CircleAlert,
  CircleX,
} from 'lucide-react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePrefs } from '../context/PrefsContext';
import { PageHeader } from '../components/Layout';
import { Field, Segmented } from '../components/ui';
import PasskeyModal from '../components/PasskeyModal';
import LabelPreview from '../components/LabelPreview';
import { labelLayout, LABEL_FONT_DEFAULTS } from '../lib/labels';
import { saveSettings, maxNumber } from '../lib/db';
import { fileToLogo } from '../lib/files';
import { FONTS, ACCENTS, DUOS, TONES, preloadFonts, textOn } from '../lib/prefs';
import { fmtDate, today, addDays } from '../lib/format';

const FIELDS = [
  'shopName', 'tagline', 'address', 'phone', 'email', 'gstin', 'logo',
  'invoicePrefix', 'cashInvoicePrefix', 'purchasePrefix', 'defaultTax', 'defaultWarranty', 'invoiceTerms', 'invoiceFooter',
  'snPrefix', 'snNext', 'labelWidth', 'labelHeight', 'labelShowBattery', 'autoPrintLabels',
  'labelTitlePt', 'labelCodePt', 'labelInfoPt', 'labelShowWarranty',
];

const SAMPLE_DEVICE = { brand: 'Apple', model: 'iPhone 15 Pro', variant: '256', color: 'White', imei: '355262965973925', battery: 95, warranty: '6 Months' };

const TABS = [
  { id: 'general', label: 'General', icon: Store, shop: true, hint: 'Shop name, logo and contact details' },
  { id: 'billing', label: 'Billing', icon: Receipt, shop: true, hint: 'Bill numbers, GST and terms' },
  { id: 'devices', label: 'Devices & Labels', icon: Barcode, shop: true, hint: 'SN numbers and barcode stickers' },
  { id: 'appearance', label: 'Appearance', icon: Palette, hint: 'Theme, font, background and motion' },
  { id: 'colors', label: 'Colors', icon: Paintbrush, hint: 'Accent, background and status colours' },
  { id: 'sidebar', label: 'Sidebar', icon: PanelLeft, hint: 'Sidebar style and size' },
  { id: 'tables', label: 'Tables & Lists', icon: Table, hint: 'Rows, dates and start page' },
  { id: 'account', label: 'Account & Security', icon: ShieldCheck, hint: 'Password and passkey' },
];

export default function Settings() {
  const { settings, privacy, raw } = useData();
  const { user, logout } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('tab')) || TABS[0];
  const [f, setF] = useState(() => pick(settings));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const logoInput = useRef();
  const touched = useRef(new Set());

  // follow live changes from other devices until the user starts editing
  useEffect(() => {
    if (!dirty) setF(pick(settings));
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (k, v) => {
    setDirty(true);
    touched.current.add(k);
    setF((p) => ({ ...p, [k]: v }));
  };
  const set = (k) => (e) => edit(k, e.target.value);
  const setBool = (k) => (e) => edit(k, e.target.checked);

  // highest SN already given with the prefix being typed - the next number must be above it
  const snUsed = maxNumber(raw.devices.map((d) => d.sn), f.snPrefix || '');
  const previewDevice = { ...SAMPLE_DEVICE, sn: `${f.snPrefix || ''}${Math.floor(Number(f.snNext)) || 1}` };

  const save = async (e) => {
    e?.preventDefault();
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
      setDirty(false);
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
      edit('logo', await fileToLogo(file));
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

  const go = (id) => setParams(id === 'general' ? {} : { tab: id }, { replace: true });

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle={tab.hint}
        actions={
          tab.shop ? (
            <>
              {dirty && <span className="chip caution" style={{ margin: '0 6px' }}>Unsaved changes</span>}
              <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
                <Save size={16} /> {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : null
        }
      />

      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                className={`settings-tab ${t.id === tab.id ? 'active' : ''}`}
                aria-current={t.id === tab.id ? 'page' : undefined}
                onClick={() => go(t.id)}
              >
                <Icon size={17} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-body" key={tab.id}>
          {tab.id === 'general' && (
            <form onSubmit={save} className="stack">
              <Section title="Shop profile" desc="Shown on the sidebar and printed on every bill and report.">
                <div className="row" style={{ gap: 16, marginBottom: 20, alignItems: 'center' }}>
                  <div className="brand-logo" style={{ width: 80, height: 80, borderRadius: 22 }}>
                    {f.logo ? <img src={f.logo} alt="Shop logo" /> : <Smartphone size={34} />}
                  </div>
                  <div className="stack-sm">
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={() => logoInput.current.click()}><Upload size={15} /> Upload logo</button>
                      {f.logo && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => edit('logo', '')}>
                          <Trash2 size={15} /> Remove
                        </button>
                      )}
                    </div>
                    <span className="xs muted">Square image works best.</span>
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
              </Section>
            </form>
          )}

          {tab.id === 'billing' && (
            <form onSubmit={save} className="stack">
              <Section title="Bill numbers" desc="Each new bill takes the next number in its series.">
                <div className="form-grid">
                  <Field label="Invoice prefix" hint="e.g. INV- → INV-0001"><input className="input mono" value={f.invoicePrefix} onChange={set('invoicePrefix')} /></Field>
                  {privacy.unlocked && (
                    <Field label="Private bill prefix" hint="Separate series for private sales"><input className="input mono" value={f.cashInvoicePrefix} onChange={set('cashInvoicePrefix')} /></Field>
                  )}
                  <Field label="Purchase prefix"><input className="input mono" value={f.purchasePrefix} onChange={set('purchasePrefix')} /></Field>
                </div>
              </Section>
              <Section title="Defaults on a new bill">
                <div className="form-grid">
                  <Field label="Default GST %"><input className="input num" type="number" min="0" step="0.01" value={f.defaultTax} onChange={set('defaultTax')} /></Field>
                  <Field label="Default warranty (used phones)"><input className="input" value={f.defaultWarranty} onChange={set('defaultWarranty')} placeholder="e.g. 7 days checking warranty" /></Field>
                </div>
              </Section>
              <Section title="Printed on the bill">
                <Field label="Terms & conditions">
                  <textarea className="textarea" rows={4} value={f.invoiceTerms} onChange={set('invoiceTerms')} />
                </Field>
                <Field label="Footer line" style={{ marginTop: 12 }}>
                  <input className="input" value={f.invoiceFooter} onChange={set('invoiceFooter')} />
                </Field>
              </Section>
            </form>
          )}

          {tab.id === 'devices' && (
            <form onSubmit={save} className="stack">
              <Section title="Device SN" desc="Every device you buy gets the next SN automatically.">
                <div className="form-grid">
                  <Field label="SN prefix" hint="e.g. G- → G-523">
                    <input className="input mono" value={f.snPrefix} onChange={set('snPrefix')} />
                  </Field>
                  <Field label="Next SN number" hint={snUsed ? `Last used: ${f.snPrefix}${snUsed}` : 'No SN used yet with this prefix'}>
                    <input className="input num" type="number" min="1" step="1" value={f.snNext} onChange={set('snNext')} />
                  </Field>
                </div>
              </Section>
              <Section title="Barcode sticker" desc="Size, text and what is printed on each sticker.">
                <div className="grid grid-2" style={{ alignItems: 'start' }}>
                  <div className="stack">
                    <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                      <Field label="Width (mm)">
                        <input className="input num" type="number" min="25" max="120" value={f.labelWidth} onChange={set('labelWidth')} />
                      </Field>
                      <Field label="Height (mm)">
                        <input className="input num" type="number" min="12" max="80" value={f.labelHeight} onChange={set('labelHeight')} />
                      </Field>
                    </div>
                    <div className="field-label">Text size (pt)</div>
                    <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', marginTop: -8 }}>
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
                    <Toggle checked={f.labelShowWarranty !== false} onChange={setBool('labelShowWarranty')} label="Print warranty" />
                    <Toggle checked={f.labelShowBattery !== false} onChange={setBool('labelShowBattery')} label="Print battery health (BH)" />
                    <Toggle checked={Boolean(f.autoPrintLabels)} onChange={setBool('autoPrintLabels')} label="Print stickers automatically after saving a purchase" />
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
              </Section>
            </form>
          )}

          {tab.id === 'appearance' && <AppearanceTab />}
          {tab.id === 'colors' && <ColorsTab />}
          {tab.id === 'sidebar' && <SidebarTab />}
          {tab.id === 'tables' && <TablesTab />}

          {tab.id === 'account' && (
            <div className="stack">
              <Section title="Account" desc={<>Signed in as <b>{user?.email}</b></>}>
                <form onSubmit={changePassword} className="form-grid" style={{ alignItems: 'end' }}>
                  <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
                  <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                  <button className="btn" disabled={!pw.current || !pw.next}>Change password</button>
                </form>
              </Section>
              {privacy.unlocked && (
                <Section title="Passkey" desc="Used to open the private view. Tap the logo 5 times to lock or unlock.">
                  <button type="button" className="btn" onClick={() => setChangingKey(true)}><KeyRound size={16} /> Change passkey</button>
                </Section>
              )}
              <Section title="Sign out" desc="Sign out of IBELL MOBILE on this device.">
                <button type="button" className="btn btn-danger" onClick={logout}><LogOut size={16} /> Sign out</button>
              </Section>
            </div>
          )}
        </div>
      </div>
      <PasskeyModal open={changingKey} forceSet onClose={(ok) => { setChangingKey(false); if (ok) toast('Passkey changed'); }} />
    </div>
  );
}

/* ------------------------------------------------------------------ UI preference tabs (instant, per user) */

function PrefsNote() {
  const { reset } = usePrefs();
  const toast = useToast();
  return (
    <div className="row-between settings-note">
      <span className="small muted">Changes apply instantly and are saved to your account, so they follow you to any device.</span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          reset();
          toast('Appearance reset to defaults');
        }}
      >
        <RotateCcw size={15} /> Reset to defaults
      </button>
    </div>
  );
}

function AppearanceTab() {
  const { prefs, update } = usePrefs();
  useEffect(preloadFonts, []);
  return (
    <div className="stack">
      <PrefsNote />
      <Section title="Theme">
        <Segmented
          label="Theme"
          value={prefs.theme}
          onChange={(v) => update({ theme: v })}
          options={[
            { value: 'system', label: <><Monitor size={14} /> System</> },
            { value: 'light', label: <><Sun size={14} /> White</> },
            { value: 'dark', label: <><Moon size={14} /> Black</> },
          ]}
        />
      </Section>
      <Section title="Font" desc="Used for all text in the app (bills and stickers keep their print font).">
        <Choices
          value={prefs.font}
          onChange={(v) => update({ font: v })}
          options={Object.entries(FONTS).map(([value, ft]) => ({
            value,
            label: ft.label,
            sub: value === 'inter' ? 'Default' : undefined,
            preview: <span className="font-sample" style={{ fontFamily: ft.family }}>Aa 123</span>,
          }))}
        />
      </Section>
      <Section title="Background" desc="Moving backgrounds are slow and subtle, and stop when Motion is reduced.">
        <Choices
          value={prefs.background}
          onChange={(v) => update({ background: v })}
          options={[
            { value: 'glow', label: 'Soft glow', sub: 'Default', preview: <span className="bg-swatch sw-glow" /> },
            { value: 'plain', label: 'Plain', preview: <span className="bg-swatch sw-plain" /> },
            { value: 'aurora', label: 'Aurora', sub: 'Animated', preview: <span className="bg-swatch sw-aurora" /> },
            { value: 'dots', label: 'Dots', sub: 'Animated', preview: <span className="bg-swatch sw-dots" /> },
            { value: 'grid', label: 'Grid', sub: 'Animated', preview: <span className="bg-swatch sw-grid" /> },
          ]}
        />
      </Section>
      <Section title="Surfaces">
        <OptionRow title="Glass effect" desc="See-through, blurred bars and dialogs. Turn off for solid panels (faster on old computers).">
          <Segmented label="Glass effect" value={prefs.glass} onChange={(v) => update({ glass: v })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        </OptionRow>
        <OptionRow title="Corners" desc="How round cards, buttons and fields are.">
          <Segmented
            label="Corners"
            value={prefs.radius}
            onChange={(v) => update({ radius: v })}
            options={[{ value: 'rounded', label: 'Rounded' }, { value: 'soft', label: 'Soft' }, { value: 'square', label: 'Square' }]}
          />
        </OptionRow>
        <OptionRow title="Text size">
          <Segmented
            label="Text size"
            value={prefs.textSize}
            onChange={(v) => update({ textSize: v })}
            options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Default' }, { value: 'lg', label: 'Large' }]}
          />
        </OptionRow>
        <OptionRow title="Motion" desc="Animations when pages open and controls move. 'Off' also stops moving backgrounds.">
          <Segmented
            label="Motion"
            value={prefs.motion}
            onChange={(v) => update({ motion: v })}
            options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }]}
          />
        </OptionRow>
      </Section>
    </div>
  );
}

const COLOR_KEYS = ['accent', 'accent2', 'bgTone', 'bgLight', 'bgDark', 'successColor', 'warningColor', 'dangerColor'];
const STATUS_DEFAULTS = { successColor: '#1e6b3a', warningColor: '#7a5200', dangerColor: '#b3261e' };

function ColorsTab() {
  const { prefs, update, reset } = usePrefs();
  const toast = useToast();
  const isHex = /^#[0-9a-f]{6}$/i.test(prefs.accent);
  const single = !prefs.accent2; // a combo has a second colour (custom) or is a DUOS preset
  const custom = isHex && single ? prefs.accent : '';
  const customDuo = isHex && !single;
  const duoA = customDuo ? prefs.accent : '#2563eb';
  const duoB = customDuo ? prefs.accent2 : '#ec4899';
  return (
    <div className="stack">
      <div className="row-between settings-note">
        <span className="small muted">Colours apply instantly to every page, in both White and Black mode, and are saved to your account.</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            reset(COLOR_KEYS);
            toast('Colours reset to black & white');
          }}
        >
          <RotateCcw size={15} /> Reset colours
        </button>
      </div>

      <Section title="Preview">
        <ColorPreview />
      </Section>

      <Section title="Accent colour" desc="Buttons, the selected menu item, tabs, charts and focus rings. Text on it turns black or white automatically to stay readable.">
        <div className="field-label" style={{ marginBottom: 8 }}>Single colour</div>
        <div className="swatches" role="radiogroup" aria-label="Single accent colour">
          <Swatch label="Black & White" on={prefs.accent === 'mono'} onClick={() => update({ accent: 'mono', accent2: '' })} mono />
          {Object.entries(ACCENTS).map(([k, a]) => (
            <Swatch key={k} label={a.label} color={a.hex} on={prefs.accent === k && single} onClick={() => update({ accent: k, accent2: '' })} />
          ))}
          <label className={`swatch swatch-custom ${custom ? 'on' : ''}`} title="Custom colour">
            <span className="swatch-dot" style={{ background: custom || 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)' }}>
              {custom ? <Check size={16} color={textOn(custom)} /> : <Pipette size={15} color="#fff" />}
            </span>
            <span className="xs">Custom</span>
            <input type="color" value={custom || '#2563eb'} onChange={(e) => update({ accent: e.target.value, accent2: '' })} aria-label="Custom accent colour" />
          </label>
        </div>

        <div className="field-label" style={{ margin: '20px 0 8px' }}>Two-colour combo</div>
        <div className="swatches" role="radiogroup" aria-label="Two-colour combo">
          {Object.entries(DUOS).map(([k, dd]) => (
            <Swatch key={k} label={dd.label} colors={dd.colors} on={prefs.accent === k} onClick={() => update({ accent: k, accent2: '' })} />
          ))}
        </div>

        <div className={`duo-custom ${customDuo ? 'on' : ''}`}>
          <span className="swatch-dot" style={{ background: `linear-gradient(135deg, ${duoA} 50%, ${duoB} 50%)`, flex: 'none' }} aria-hidden="true">
            {customDuo && <Check size={16} color={textOn(duoA, duoB)} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="option-title">Custom combo</div>
            <div className="xs muted">Pick any two colours. Filled buttons and highlights blend from colour 1 to colour 2.</div>
          </div>
          <div className="row" style={{ gap: 12, marginLeft: 'auto' }}>
            <MiniColor label="Colour 1" value={duoA} onChange={(v) => update({ accent: v, accent2: duoB })} />
            <MiniColor label="Colour 2" value={duoB} onChange={(v) => update({ accent: duoA, accent2: v })} />
            {!customDuo && (
              <button type="button" className="btn btn-sm" onClick={() => update({ accent: duoA, accent2: duoB })}>Use</button>
            )}
          </div>
        </div>
      </Section>

      <Section title="Background tone" desc="A light tint behind the cards and panels.">
        <Choices
          value={prefs.bgTone}
          onChange={(v) => update({ bgTone: v })}
          options={[
            ...Object.entries(TONES).map(([k, t]) => ({
              value: k,
              label: t.label,
              sub: k === 'neutral' ? 'Default' : undefined,
              preview: <ToneSwatch light={t.light?.[0] || '#ededed'} dark={t.dark?.[0] || '#000000'} />,
            })),
            { value: 'custom', label: 'Custom', sub: 'Pick below', preview: <ToneSwatch light={prefs.bgLight || '#ededed'} dark={prefs.bgDark || '#000000'} /> },
          ]}
        />
        {prefs.bgTone === 'custom' && (
          <div className="form-grid" style={{ marginTop: 16 }}>
            <ColorField label="Background in White mode" value={prefs.bgLight || '#ededed'} onChange={(v) => update({ bgLight: v })} />
            <ColorField label="Background in Black mode" value={prefs.bgDark || '#000000'} onChange={(v) => update({ bgDark: v })} />
          </div>
        )}
      </Section>

      <Section title="Status colours" desc="Paid / due chips, money in and out, alerts and errors. Every status also shows text or an icon, never colour alone.">
        <div className="form-grid">
          <ColorField label="Success (paid, in stock, money in)" value={prefs.successColor || STATUS_DEFAULTS.successColor} onChange={(v) => update({ successColor: v })} reset={prefs.successColor ? () => update({ successColor: '' }) : null} />
          <ColorField label="Warning (due, at repair)" value={prefs.warningColor || STATUS_DEFAULTS.warningColor} onChange={(v) => update({ warningColor: v })} reset={prefs.warningColor ? () => update({ warningColor: '' }) : null} />
          <ColorField label="Danger (missing, errors, money out)" value={prefs.dangerColor || STATUS_DEFAULTS.dangerColor} onChange={(v) => update({ dangerColor: v })} reset={prefs.dangerColor ? () => update({ dangerColor: '' }) : null} />
        </div>
      </Section>
    </div>
  );
}

function Swatch({ label, color, colors, on, onClick, mono }) {
  const bg = mono
    ? 'linear-gradient(135deg, #0a0a0a 50%, #ffffff 50%)'
    : colors
      ? `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`
      : color;
  const tick = mono ? '#ffffff' : colors ? textOn(colors[0], colors[1]) : textOn(color);
  return (
    <button type="button" role="radio" aria-checked={on} className={`swatch ${on ? 'on' : ''}`} onClick={onClick} title={label}>
      <span className="swatch-dot" style={{ background: bg }}>
        {on && <Check size={16} color={tick} style={mono ? { mixBlendMode: 'difference' } : undefined} />}
      </span>
      <span className="xs">{label}</span>
    </button>
  );
}

function MiniColor({ label, value, onChange }) {
  return (
    <label className="mini-color" title={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <span className="xs">{label}</span>
    </label>
  );
}

function ToneSwatch({ light, dark }) {
  return (
    <span className="tone-swatch" aria-hidden="true">
      <span style={{ background: light }}><i /></span>
      <span style={{ background: dark }}><i /></span>
    </span>
  );
}

function ColorField({ label, value, onChange, reset }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="color-field">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <input
          className="input mono"
          value={text}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setText(value)}
          aria-label={`${label} hex`}
        />
        {reset && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>Default</button>
        )}
      </div>
    </div>
  );
}

function ColorPreview() {
  return (
    <div className="color-preview">
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm">Primary button</button>
        <button type="button" className="btn btn-sm">Normal</button>
        <Segmented label="Preview tabs" value="b" onChange={() => {}} options={[{ value: 'a', label: 'Day' }, { value: 'b', label: 'Month' }, { value: 'c', label: 'Year' }]} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <span className="chip success">Paid</span>
        <span className="chip caution">Due ₹6,000</span>
        <span className="chip urgent">Missing</span>
        <span className="small pos"><CircleCheck size={14} /> In ₹36,000</span>
        <span className="small neg"><CircleX size={14} /> Out ₹2,500</span>
        <span className="small" style={{ color: 'var(--color-error)' }}><CircleAlert size={14} /> Error text</span>
      </div>
      <div className="audit-progress" style={{ marginTop: 14 }}><div style={{ width: '62%' }} /></div>
    </div>
  );
}

function SidebarTab() {
  const { prefs, update } = usePrefs();
  return (
    <div className="stack">
      <PrefsNote />
      <Section title="Sidebar style">
        <Choices
          value={prefs.sidebarStyle}
          onChange={(v) => update({ sidebarStyle: v })}
          options={[
            { value: 'glass', label: 'Floating glass', sub: 'Default', preview: <MiniLayout variant="glass" /> },
            { value: 'solid', label: 'Solid panel', preview: <MiniLayout variant="solid" /> },
            { value: 'flush', label: 'Flush edge', preview: <MiniLayout variant="flush" /> },
          ]}
        />
      </Section>
      <Section title="Width">
        <Choices
          value={prefs.sidebarWidth}
          onChange={(v) => update({ sidebarWidth: v })}
          options={[
            { value: 'comfortable', label: 'Comfortable', sub: 'Default', preview: <MiniLayout variant="glass" width="wide" /> },
            { value: 'compact', label: 'Compact', preview: <MiniLayout variant="glass" width="compact" /> },
            { value: 'icons', label: 'Icons only', sub: 'Labels on hover', preview: <MiniLayout variant="glass" width="icons" /> },
          ]}
        />
      </Section>
      <Section>
        <OptionRow title="Section headings" desc="Overview, Trade, Accounts and Shop titles above each group of links.">
          <Segmented label="Section headings" value={prefs.sidebarLabels} onChange={(v) => update({ sidebarLabels: v })} options={[{ value: 'on', label: 'Show' }, { value: 'off', label: 'Hide' }]} />
        </OptionRow>
      </Section>
    </div>
  );
}

const TABLE_KEYS = [
  'tableHeader', 'tableHeaderCase', 'tableSticky', 'tableSort', 'tableLines', 'tableColumns', 'tableBorder',
  'tableDensity', 'tableStripes', 'tableHover', 'tableText', 'pageSize',
];

const SAMPLE_ROWS = [
  ['INV-0108', 'Walk-in Customer', 36000, 'Paid', 0],
  ['INV-0107', 'Amit Kumar', 18500, 'Due', -1],
  ['INV-0106', 'Raj Traders', 72000, 'Paid', -2],
  ['INV-0105', 'Jenish Mobile', 12999, 'Due', -4],
  ['INV-0104', 'Walk-in Customer', 9800, 'Paid', -6],
  ['INV-0103', 'Kiran Patel', 54000, 'Paid', -9],
  ['INV-0102', 'Amit Kumar', 23500, 'Due', -12],
  ['INV-0101', 'Raj Traders', 41000, 'Paid', -15],
];

function TablesTab() {
  const { prefs, update, reset } = usePrefs();
  const toast = useToast();
  const seg = (key, label, options) => (
    <Segmented label={label} value={prefs[key]} onChange={(v) => update({ [key]: v })} options={options} />
  );
  const onOff = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];
  return (
    <div className="stack">
      <div className="row-between settings-note">
        <span className="small muted">Every table in the app follows these settings. Changes apply instantly and are saved to your account.</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            reset(TABLE_KEYS);
            toast('Table options reset');
          }}
        >
          <RotateCcw size={15} /> Reset table options
        </button>
      </div>

      <Section title="Live preview" desc={prefs.tableSort === 'on' ? 'Click any column header to sort - click again to reverse.' : undefined}>
        <div className="table-wrap" style={prefs.tableSticky === 'on' ? { maxHeight: 220 } : undefined}>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Status</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {SAMPLE_ROWS.map(([no, cust, total, status, days]) => (
                <tr key={no} className="clickable">
                  <td className="tnum">{fmtDate(addDays(today(), days))}</td>
                  <td className="cell-main">{no}</td>
                  <td>{cust}</td>
                  <td>{status === 'Paid' ? <span className="chip success">Paid</span> : <span className="chip caution">Due</span>}</td>
                  <td className="num">₹{total.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Header">
        <Choices
          value={prefs.tableHeader}
          onChange={(v) => update({ tableHeader: v })}
          options={[
            { value: 'minimal', label: 'Minimal', sub: 'Default', preview: <MiniTable variant="minimal" /> },
            { value: 'shaded', label: 'Shaded', preview: <MiniTable variant="shaded" /> },
            { value: 'solid', label: 'Solid colour', sub: 'Uses your accent / combo', preview: <MiniTable variant="solid" /> },
            { value: 'accent', label: 'Accent line', preview: <MiniTable variant="accent" /> },
          ]}
        />
        <div style={{ marginTop: 16 }}>
          <OptionRow title="Header text" desc="Column names in capitals or normal case.">
            {seg('tableHeaderCase', 'Header text', [{ value: 'upper', label: 'UPPERCASE' }, { value: 'normal', label: 'Normal' }])}
          </OptionRow>
          <OptionRow title="Click to sort" desc="Click a column header to sort by it; click again to reverse. Works on every table, with numbers, ₹ amounts and dates.">
            {seg('tableSort', 'Click to sort', onOff)}
          </OptionRow>
          <OptionRow title="Sticky header" desc="Long tables scroll inside their card and the header row stays in view.">
            {seg('tableSticky', 'Sticky header', [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }])}
          </OptionRow>
        </div>
      </Section>

      <Section title="Lines & borders">
        <OptionRow title="Row lines" desc="Horizontal line between rows.">
          {seg('tableLines', 'Row lines', onOff)}
        </OptionRow>
        <OptionRow title="Column lines" desc="Vertical line between columns - like a register book.">
          {seg('tableColumns', 'Column lines', [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }])}
        </OptionRow>
        <OptionRow title="Outer border" desc="A border around the whole table.">
          {seg('tableBorder', 'Outer border', [{ value: 'none', label: 'None' }, { value: 'outline', label: 'Border' }])}
        </OptionRow>
      </Section>

      <Section title="Rows">
        <OptionRow title="Row density" desc="Space inside each row.">
          {seg('tableDensity', 'Row density', [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }])}
        </OptionRow>
        <OptionRow title="Striped rows" desc="Shade every other row - easier to follow long lists.">
          {seg('tableStripes', 'Striped rows', [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }])}
        </OptionRow>
        <OptionRow title="Hover highlight" desc="Highlight the row under the mouse.">
          {seg('tableHover', 'Hover highlight', onOff)}
        </OptionRow>
        <OptionRow title="Table text size">
          {seg('tableText', 'Table text size', [{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Default' }, { value: 'lg', label: 'Large' }])}
        </OptionRow>
        <OptionRow title="Rows per page" desc="How many rows each list shows before the page buttons. Can also be changed under any table.">
          {seg('pageSize', 'Rows per page', ['10', '25', '50', '100'].map((n) => ({ value: n, label: n })))}
        </OptionRow>
      </Section>
      <Section title="Lists & dates">
        <OptionRow title="Default date range" desc="What Sales, Purchases, Payments, Expenses, Banks and Analysis show when opened.">
          <select className="select" style={{ width: 220 }} value={prefs.defaultRange} onChange={(e) => update({ defaultRange: e.target.value })} aria-label="Default date range">
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="month">This month</option>
            <option value="fy">This financial year</option>
            <option value="all">All time</option>
          </select>
        </OptionRow>
        <OptionRow title="Date format" desc="Used on screens, bills and reports.">
          <select className="select" style={{ width: 220 }} value={prefs.dateFormat} onChange={(e) => update({ dateFormat: e.target.value })} aria-label="Date format">
            <option value="medium">15 Oct 2026</option>
            <option value="dmy">15/10/2026</option>
            <option value="iso">2026-10-15</option>
          </select>
        </OptionRow>
        <OptionRow title="Start page" desc="The page that opens after you sign in.">
          <select className="select" style={{ width: 220 }} value={prefs.startPage} onChange={(e) => update({ startPage: e.target.value })} aria-label="Start page">
            <option value="/">Dashboard</option>
            <option value="/sales/new">New Sale</option>
            <option value="/sales">Sales</option>
            <option value="/stock">Stock</option>
          </select>
        </OptionRow>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ building blocks */

function Section({ title, desc, children }) {
  return (
    <section className="card card-lg settings-section">
      {(title || desc) && (
        <div className="settings-section-head">
          {title && <h2>{title}</h2>}
          {desc && <p className="muted small">{desc}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function OptionRow({ title, desc, children }) {
  return (
    <div className="option-row">
      <div className="option-text">
        <div className="option-title">{title}</div>
        {desc && <div className="small muted">{desc}</div>}
      </div>
      <div className="option-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span className="small">{label}</span>
    </label>
  );
}

/** Visual single-choice cards (radio group) */
function Choices({ value, onChange, options }) {
  return (
    <div className="choices" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`choice ${o.value === value ? 'on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className="choice-preview">{o.preview}</span>
          <span className="choice-label">
            <span>
              <b>{o.label}</b>
              {o.sub && <span className="xs muted" style={{ display: 'block' }}>{o.sub}</span>}
            </span>
            {o.value === value && <Check size={16} />}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Tiny drawing of a table for the header-style choices */
function MiniTable({ variant }) {
  return (
    <span className={`mt mt-${variant}`} aria-hidden="true">
      <span className="mt-head">
        <i />
        <i />
        <i />
      </span>
      {[0, 1, 2].map((r) => (
        <span key={r} className="mt-row">
          <i />
          <i />
          <i />
        </span>
      ))}
    </span>
  );
}

/** Tiny drawing of the app shell for the sidebar choices */
function MiniLayout({ variant, width = 'wide' }) {
  return (
    <span className={`mini mini-${variant} mini-w-${width}`} aria-hidden="true">
      <span className="mini-side">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`mini-link ${i === 1 ? 'on' : ''}`} />
        ))}
      </span>
      <span className="mini-main">
        <span className="mini-card" />
        <span className="mini-card" />
      </span>
    </span>
  );
}

function pick(s) {
  const o = {};
  for (const k of FIELDS) o[k] = s[k] ?? '';
  return o;
}
