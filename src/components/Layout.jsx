import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  ShoppingBag,
  Boxes,
  Wrench,
  Users,
  ChartColumn,
  History,
  Landmark,
  Wallet,
  Receipt,
  Settings,
  LogOut,
  Smartphone,
  Menu,
  LockOpen,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import PasskeyModal from './PasskeyModal';
import { SkeletonPage, useScrolled } from './ui';

const NAV = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/analysis', label: 'Analysis', icon: ChartColumn },
    ],
  },
  {
    label: 'Trade',
    items: [
      { to: '/sales', label: 'Sales', icon: ShoppingCart },
      { to: '/purchases', label: 'Purchases', icon: ShoppingBag },
      { to: '/stock', label: 'Stock', icon: Boxes },
      { to: '/repairs', label: 'Repairs', icon: Wrench },
      { to: '/timeline', label: 'IMEI Timeline', icon: History },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/parties', label: 'Parties', icon: Users },
      { to: '/payments', label: 'Payments', icon: Wallet },
      { to: '/banks', label: 'Banks', icon: Landmark },
      { to: '/expenses', label: 'Expenses', icon: Receipt },
    ],
  },
  {
    label: 'Shop',
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
];

const LayoutContext = createContext({ openMenu: () => {} });
export const useLayout = () => useContext(LayoutContext);

export default function Layout() {
  const { user, logout } = useAuth();
  const { settings, privacy, ready, error } = useData();
  const toast = useToast();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const navRef = useRef();
  const [pill, setPill] = useState(null);
  const taps = useRef([]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // selection pill follows the active nav item
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="page"]');
    setPill(el ? { y: el.offsetTop, h: el.offsetHeight } : null);
  }, [location.pathname]);

  // 5 quick taps on the logo open the passkey dialog (or lock again if already open)
  const onLogoTap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      if (privacy.unlocked) {
        privacy.lock();
        toast('Locked');
      } else if (privacy.passkeyLoaded) {
        setPassOpen(true);
      }
    }
  };

  return (
    <LayoutContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      <div className="shell">
        <aside className={`sidebar glass ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
          <button type="button" className="brand" onClick={onLogoTap} aria-label={settings.shopName}>
            <span className="brand-logo">
              {settings.logo ? <img src={settings.logo} alt="" /> : <Smartphone size={22} />}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="brand-name" style={{ display: 'block' }}>{settings.shopName}</span>
              <span className="brand-sub">{settings.tagline}</span>
            </span>
          </button>

          <nav className="nav" ref={navRef}>
            {pill && (
              <span className="nav-pill" style={{ height: pill.h, transform: `translateY(${pill.y}px)`, top: 0 }} />
            )}
            {NAV.map((group) => (
              <div className="nav-group" key={group.label} role="group" aria-label={group.label}>
                <div className="nav-label" aria-hidden="true">{group.label}</div>
                {group.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink key={to} to={to} end={end} className="nav-item">
                    <Icon size={18} />
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <span className="avatar" aria-hidden="true">{(user?.displayName || user?.email || '?').charAt(0)}</span>
            <div className="sidebar-user">
              <div style={{ fontWeight: 600 }}>{user?.displayName || user?.email?.split('@')[0] || 'Signed in'}</div>
              <div className="muted xs">{user?.email}</div>
            </div>
            {privacy.unlocked && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => {
                  privacy.lock();
                  toast('Locked');
                }}
                aria-label="Lock private view"
                title="Lock"
              >
                <LockOpen size={17} />
              </button>
            )}
            <button className="btn btn-ghost btn-icon btn-sm" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}

        <main className="main">
          {error ? (
            <div className="card card-lg" role="alert">
              <h2 style={{ marginBottom: 8 }}>Can't load data</h2>
              <p className="muted">
                {error.code === 'permission-denied'
                  ? 'This account is not allowed to read shop data. Add its e-mail to firestore.rules and deploy the rules.'
                  : error.message}
              </p>
            </div>
          ) : ready ? (
            <Suspense fallback={<SkeletonPage />}>
              <Outlet />
            </Suspense>
          ) : (
            <>
              <div className="topbar">
                <div className="topbar-title">
                  <h1>&nbsp;</h1>
                </div>
              </div>
              <SkeletonPage />
            </>
          )}
        </main>
      </div>
      <PasskeyModal
        open={passOpen}
        onClose={(ok) => {
          setPassOpen(false);
          if (ok) toast('Unlocked');
        }}
      />
    </LayoutContext.Provider>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  const { openMenu } = useLayout();
  const scrolled = useScrolled();
  return (
    <header className={`topbar ${scrolled ? 'stuck' : ''}`}>
      <div className="capsule-group glass menu-btn">
        <button className="btn btn-icon" onClick={openMenu} aria-label="Open menu">
          <Menu size={20} />
        </button>
      </div>
      {back}
      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="capsule-group glass">{actions}</div>}
    </header>
  );
}
