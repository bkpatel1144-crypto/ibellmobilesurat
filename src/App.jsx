import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isConfigured } from './firebase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ToastProvider } from './context/ToastContext';
import { PrefsProvider } from './context/PrefsContext';
import Layout from './components/Layout';
import Guard from './components/Guard';
import { SkeletonPage } from './components/ui';
import Login from './pages/Login';
import Setup from './pages/Setup';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Sales = lazy(() => import('./pages/Sales'));
const SaleNew = lazy(() => import('./pages/SaleNew'));
const SaleView = lazy(() => import('./pages/SaleView'));
const Purchases = lazy(() => import('./pages/Purchases'));
const PurchaseNew = lazy(() => import('./pages/PurchaseNew'));
const PurchaseView = lazy(() => import('./pages/PurchaseView'));
const Returns = lazy(() => import('./pages/Returns'));
const ReturnNew = lazy(() => import('./pages/ReturnNew'));
const ReturnView = lazy(() => import('./pages/ReturnView'));
const Stock = lazy(() => import('./pages/Stock'));
const Repairs = lazy(() => import('./pages/Repairs'));
const Audit = lazy(() => import('./pages/Audit'));
const Parties = lazy(() => import('./pages/Parties'));
const PartyView = lazy(() => import('./pages/PartyView'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Timeline = lazy(() => import('./pages/Timeline'));
const Banks = lazy(() => import('./pages/Banks'));
const Payments = lazy(() => import('./pages/Payments'));
const Expenses = lazy(() => import('./pages/Expenses'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Gst = lazy(() => import('./pages/Gst'));
const Activity = lazy(() => import('./pages/Activity'));

function Gate() {
  const { user } = useAuth();
  if (user === undefined) {
    return (
      <div className="auth-page">
        <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 20 }} />
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <DataProvider>
      <Suspense fallback={<SkeletonPage />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="sales" element={<Sales />} />
            <Route path="sales/new" element={<SaleNew />} />
            <Route path="sales/:id" element={<SaleView />} />
            <Route path="purchases" element={<Purchases />} />
            <Route path="purchases/new" element={<PurchaseNew />} />
            <Route path="purchases/:id" element={<PurchaseView />} />
            <Route path="purchases/:id/edit" element={<PurchaseNew />} />
            <Route path="returns" element={<Returns />} />
            <Route path="returns/new" element={<ReturnNew />} />
            <Route path="returns/:id" element={<ReturnView />} />
            <Route path="returns/:id/edit" element={<ReturnNew />} />
            <Route path="stock" element={<Stock />} />
            <Route path="repairs" element={<Repairs />} />
            <Route path="audit" element={<Audit />} />
            <Route path="audit/:id" element={<Audit />} />
            <Route path="parties" element={<Parties />} />
            <Route path="parties/:id" element={<PartyView />} />
            <Route path="analysis" element={<Guard perm="reports" title="Analysis"><Analysis /></Guard>} />
            <Route path="gst" element={<Guard perm="reports" title="GST Report"><Gst /></Guard>} />
            <Route path="activity" element={<Guard perm="reports" title="Activity log"><Activity /></Guard>} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="timeline/:imei" element={<Timeline />} />
            <Route path="banks" element={<Guard perm="banks" title="Banks"><Banks /></Guard>} />
            <Route path="payments" element={<Guard perm="banks" title="Payments"><Payments /></Guard>} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </DataProvider>
  );
}

export default function App() {
  if (!isConfigured) return <Setup />;
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <PrefsProvider>
            <Gate />
          </PrefsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
