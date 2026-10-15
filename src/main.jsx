import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from './lib/theme';
import './styles/app.css';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
