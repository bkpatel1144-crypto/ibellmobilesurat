// Per-user UI preferences. The defaults are the app's standard look; every option is
// applied as a data-* attribute / CSS variable on <html> (styles live in app.css) so changes are instant.
import { applyTheme } from './theme';
import { setDateFormat } from './format';

export const PREF_DEFAULTS = {
  theme: 'system', // system | light | dark
  background: 'glow', // glow | plain | aurora | dots | grid
  glass: 'on', // on | off
  radius: 'rounded', // rounded | soft | square
  textSize: 'md', // sm | md | lg
  font: 'inter', // see FONTS
  motion: 'full', // full | reduced | off
  accent: 'mono', // mono | a key of ACCENTS | a key of DUOS | #rrggbb
  accent2: '', // #rrggbb - second colour of a custom two-colour combo ('' = single colour)
  bgTone: 'neutral', // neutral | warm | cool | mint | lavender | custom
  bgLight: '', // #rrggbb - custom background in White mode
  bgDark: '', // #rrggbb - custom background in Black mode
  successColor: '', // #rrggbb - '' = default
  warningColor: '',
  dangerColor: '',
  sidebarStyle: 'glass', // glass | solid | flush
  sidebarWidth: 'comfortable', // comfortable | compact | icons
  sidebarLabels: 'on', // on | off
  tableDensity: 'comfortable', // comfortable | compact | spacious
  tableStripes: 'off', // off | on
  tableLines: 'on', // on | off  (row lines)
  tableColumns: 'off', // off | on  (vertical column lines)
  tableBorder: 'none', // none | outline
  tableHeader: 'minimal', // minimal | shaded | solid | accent
  tableHeaderCase: 'upper', // upper | normal
  tableSticky: 'off', // off | on  (header stays visible, table scrolls inside its card)
  tableSort: 'on', // on | off  (click a header to sort)
  tableHover: 'on', // on | off  (highlight the row under the pointer)
  tableText: 'md', // sm | md | lg
  pageSize: '25', // 10 | 25 | 50 | 100 rows per page
  defaultRange: 'month', // today | 7d | month | fy | all
  dateFormat: 'medium', // medium | dmy | iso
  startPage: '/', // / | /sales/new | /sales | /stock
};

const COLOR_KEYS = ['accent2', 'bgLight', 'bgDark', 'successColor', 'warningColor', 'dangerColor'];
const HEX = /^#[0-9a-f]{6}$/i;

/** Accent presets (mono = the standard black & white). */
export const ACCENTS = {
  blue: { label: 'Blue', hex: '#2563eb' },
  indigo: { label: 'Indigo', hex: '#4f46e5' },
  violet: { label: 'Violet', hex: '#7c3aed' },
  green: { label: 'Green', hex: '#16a34a' },
  teal: { label: 'Teal', hex: '#0d9488' },
  orange: { label: 'Orange', hex: '#ea580c' },
  red: { label: 'Red', hex: '#dc2626' },
  pink: { label: 'Pink', hex: '#db2777' },
};

/** Two-colour combos: filled surfaces get a gradient from the first to the second colour. */
export const DUOS = {
  'black-gold': { label: 'Black & Gold', colors: ['#111111', '#d4a017'] },
  'navy-gold': { label: 'Navy & Gold', colors: ['#1e3a8a', '#f59e0b'] },
  'blue-cyan': { label: 'Blue & Cyan', colors: ['#2563eb', '#06b6d4'] },
  'purple-pink': { label: 'Purple & Pink', colors: ['#7c3aed', '#ec4899'] },
  'indigo-violet': { label: 'Indigo & Violet', colors: ['#4338ca', '#a855f7'] },
  'teal-lime': { label: 'Teal & Lime', colors: ['#0f766e', '#84cc16'] },
  sunset: { label: 'Sunset', colors: ['#f97316', '#e11d48'] },
  'maroon-rose': { label: 'Maroon & Rose', colors: ['#881337', '#fb7185'] },
  ocean: { label: 'Ocean', colors: ['#0369a1', '#14b8a6'] },
  'coffee-cream': { label: 'Coffee & Cream', colors: ['#6f4e37', '#c8a97e'] },
  'charcoal-silver': { label: 'Charcoal & Silver', colors: ['#1f2937', '#9ca3af'] },
  'forest-mint': { label: 'Forest & Mint', colors: ['#14532d', '#34d399'] },
};

/** Background tones: [white-mode bg, card, section] and [black-mode bg, card, section]. */
export const TONES = {
  neutral: { label: 'Neutral' },
  warm: { label: 'Warm', light: ['#efebe5', '#fffdfa', '#f4f0ea'], dark: ['#0b0907', '#16130f', '#1b1713'] },
  cool: { label: 'Cool', light: ['#e9edf2', '#fbfdff', '#eef2f7'], dark: ['#06080b', '#10151b', '#151b22'] },
  mint: { label: 'Mint', light: ['#e8f0ec', '#fbfefc', '#edf4f0'], dark: ['#050a08', '#0f1613', '#141d19'] },
  lavender: { label: 'Lavender', light: ['#eeebf5', '#fdfcff', '#f2eff8'], dark: ['#08070c', '#13111a', '#18151f'] },
};

const FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** App fonts. Inter is loaded by index.html; the others load from Google Fonts only when chosen. */
export const FONTS = {
  inter: { label: 'Inter', family: `'Inter', ${FALLBACK}` },
  poppins: { label: 'Poppins', family: `'Poppins', ${FALLBACK}`, google: 'Poppins:wght@400;500;600;700' },
  roboto: { label: 'Roboto', family: `'Roboto', ${FALLBACK}`, google: 'Roboto:wght@400;500;700' },
  manrope: { label: 'Manrope', family: `'Manrope', ${FALLBACK}`, google: 'Manrope:wght@400;500;600;700' },
  nunito: { label: 'Nunito', family: `'Nunito', ${FALLBACK}`, google: 'Nunito:wght@400;600;700' },
  system: { label: 'System', family: FALLBACK },
};

/** Loads every selectable font (used by the font picker so each option previews in its own face). */
export function preloadFonts() {
  Object.keys(FONTS).forEach(ensureFont);
}

function ensureFont(key) {
  const f = FONTS[key];
  if (f?.google && !document.getElementById(`font-${key}`)) {
    const link = document.createElement('link');
    link.id = `font-${key}`;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }
}

function loadFont(key) {
  const f = FONTS[key] || FONTS.inter;
  ensureFont(key);
  document.documentElement.style.setProperty('--font-sans', f.family);
}

/* ------------------------------------------------------------------ colour helpers */

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (hex, toHex, t) => {
  const a = rgb(hex);
  const b = rgb(toHex);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Black or white text, whichever reads better on this colour (or on both ends of a gradient). */
export const textOn = (hex, hex2) => {
  const ends = hex2 ? [hex, hex2] : [hex];
  const white = Math.min(...ends.map((h) => contrast('#ffffff', h)));
  const black = Math.min(...ends.map((h) => contrast('#0a0a0a', h)));
  return black > white ? '#0a0a0a' : '#ffffff';
};
export const accentHex = (accent) => DUOS[accent]?.colors[0] || ACCENTS[accent]?.hex || (HEX.test(accent) ? accent : null);

/** [colour 1, colour 2 | null] for the chosen accent, or null for the standard black & white. */
export function accentColors(p) {
  if (DUOS[p.accent]) return DUOS[p.accent].colors;
  const c1 = accentHex(p.accent);
  if (!c1) return null;
  return [c1, HEX.test(p.accent2) ? p.accent2 : null];
}

/* ------------------------------------------------------------------ storage */

const KEY = 'ibell-prefs';
let current = { ...PREF_DEFAULTS };

/** Read anywhere without a hook (e.g. initial date range of a list). */
export const getPref = (k) => current[k] ?? PREF_DEFAULTS[k];

export function loadLocalPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // carry over the theme chosen before preferences existed
    const oldTheme = localStorage.getItem('ibell-theme');
    if (oldTheme && !saved.theme) saved.theme = oldTheme;
  } catch {
    /* storage blocked - defaults */
  }
  return clean(saved);
}

export function saveLocalPrefs(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked - prefs still apply for this session */
  }
}

/** Keeps only known keys with valid values; `_at` (ms) tells which copy is newest. */
export function clean(p = {}) {
  const out = { ...PREF_DEFAULTS, _at: Number(p._at) || 0 };
  for (const k of Object.keys(PREF_DEFAULTS)) {
    const v = p[k];
    if (typeof v !== 'string') continue;
    if (COLOR_KEYS.includes(k)) out[k] = HEX.test(v) ? v : '';
    else if (v) out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ apply */

function applyColors(p, root) {
  const st = root.style;
  const d = root.dataset;

  // accent → primary colour (separate shades for White and Black mode); a second colour
  // turns filled surfaces into a gradient
  const cols = accentColors(p);
  const forDark = (h) => (lum(h) < 0.08 ? mix(h, '#ffffff', 0.35) : h);
  const accentVars = ['--accent-l', '--accent-on-l', '--accent-d', '--accent-on-d', '--duo-1-l', '--duo-2-l', '--duo-1-d', '--duo-2-d'];
  accentVars.forEach((k) => st.removeProperty(k));
  delete d.accent;
  delete d.duo;
  if (cols) {
    const [a, b] = cols;
    st.setProperty('--accent-l', a);
    st.setProperty('--accent-on-l', textOn(a, b));
    st.setProperty('--accent-d', forDark(a));
    st.setProperty('--accent-on-d', textOn(forDark(a), b && forDark(b)));
    d.accent = 'on';
    if (b) {
      st.setProperty('--duo-1-l', a);
      st.setProperty('--duo-2-l', b);
      st.setProperty('--duo-1-d', forDark(a));
      st.setProperty('--duo-2-d', forDark(b));
      d.duo = 'on';
    }
  }

  // background tone
  const tone = p.bgTone === 'custom' ? null : TONES[p.bgTone];
  let light = tone?.light;
  let darkT = tone?.dark;
  if (p.bgTone === 'custom') {
    light = p.bgLight ? [p.bgLight, mix(p.bgLight, '#ffffff', 0.85), mix(p.bgLight, '#ffffff', 0.45)] : null;
    darkT = p.bgDark ? [p.bgDark, mix(p.bgDark, '#ffffff', 0.07), mix(p.bgDark, '#ffffff', 0.1)] : null;
  }
  if (light || darkT) {
    const L = light || ['#ededed', '#ffffff', '#f0f0f0'];
    const D = darkT || ['#000000', '#121212', '#161616'];
    ['bg', 'hi', 'c'].forEach((n, i) => {
      st.setProperty(`--tone-${n}-l`, L[i]);
      st.setProperty(`--tone-${n}-d`, D[i]);
    });
    d.tone = 'on';
  } else {
    ['bg', 'hi', 'c'].forEach((n) => {
      st.removeProperty(`--tone-${n}-l`);
      st.removeProperty(`--tone-${n}-d`);
    });
    delete d.tone;
  }

  // status colours (washes are derived in CSS)
  const status = { success: p.successColor, caution: p.warningColor, urgent: p.dangerColor };
  for (const [k, v] of Object.entries(status)) {
    if (v) {
      st.setProperty(`--color-status-${k}`, v);
      d[`status${k[0].toUpperCase()}${k.slice(1)}`] = 'on';
    } else {
      st.removeProperty(`--color-status-${k}`);
      delete d[`status${k[0].toUpperCase()}${k.slice(1)}`];
    }
  }
}

export function applyPrefs(p) {
  current = clean(p);
  const root = document.documentElement;
  const r = root.dataset;
  r.bg = current.background;
  r.glass = current.glass;
  r.radius = current.radius;
  r.text = current.textSize;
  r.motion = current.motion;
  r.sidebar = current.sidebarStyle;
  r.sidebarWidth = current.sidebarWidth;
  r.sidebarLabels = current.sidebarLabels;
  r.tableDensity = current.tableDensity;
  r.tableStripes = current.tableStripes;
  r.tableLines = current.tableLines;
  r.tableColumns = current.tableColumns;
  r.tableBorder = current.tableBorder;
  r.tableHeader = current.tableHeader;
  r.tableHeaderCase = current.tableHeaderCase;
  r.tableSticky = current.tableSticky;
  r.tableSort = current.tableSort;
  r.tableHover = current.tableHover;
  r.tableText = current.tableText;
  applyTheme(current.theme);
  applyColors(current, root);
  loadFont(current.font);
  setDateFormat(current.dateFormat);
  return current;
}
