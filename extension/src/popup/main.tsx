import React from 'react';
import ReactDOM from 'react-dom/client';
import { ExtensionClerkProvider } from './ClerkProvider';
import Popup from './Popup';
import './popup.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExtensionClerkProvider>
      <Popup />
    </ExtensionClerkProvider>
  </React.StrictMode>
);
