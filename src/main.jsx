import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyPrefs, loadLocalPrefs, getPref } from './lib/prefs';
import { applyTheme } from './lib/theme';
import { installTableSort } from './lib/tableSort';
import './styles/app.css';

// apply the saved look before the first paint (no flash); the signed-in user's prefs load later
applyPrefs(loadLocalPrefs());
installTableSort();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getPref('theme')));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
