import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { OptimizerApi } from '../shared/types';
import { App } from './App';
import { Overlay } from './Overlay';
import { applyCachedTheme } from './theme';
import './index.css';

declare global {
  interface Window {
    api: OptimizerApi;
  }
}

// The in-game overlay window loads this same page with #overlay.
const overlay = location.hash === '#overlay';
if (overlay) document.documentElement.classList.add('overlay');
else applyCachedTheme(); // the overlay keeps its own dark look

createRoot(document.getElementById('root')!).render(<StrictMode>{overlay ? <Overlay /> : <App />}</StrictMode>);
