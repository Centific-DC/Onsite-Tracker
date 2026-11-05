import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './operator.css';
import './soft.css';

// Fit scaling: laid out for 1536x864; smaller desktop windows scale the root font down to 0.8.
// Touch screens (tablets, phones) never scale: they're read at arm's length.
let raf = 0;
const fit = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const w = innerWidth, h = innerHeight;
    const s = w < 768 || matchMedia('(pointer: coarse)').matches ? 1 : Math.round(Math.min(1, Math.max(0.8, Math.min(w / 1536, h / 864))) * 1000) / 1000;
    document.documentElement.style.fontSize = `${16 * s}px`;
    document.documentElement.style.setProperty('--fit', s);
  });
};
fit();
addEventListener('resize', fit);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
