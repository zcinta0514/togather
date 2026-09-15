import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { detectDevice, applyDeviceProfile } from './lib/perf';
import './index.css';

// 在首屏渲染前就决定降级，避免先画出重特效再撤掉（那一下更难看）
applyDeviceProfile(detectDevice());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
