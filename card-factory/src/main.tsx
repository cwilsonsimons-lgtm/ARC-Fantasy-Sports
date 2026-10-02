import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

function start(data: { save?: string } = {}) {
  const root = document.getElementById('root')!;
  createRoot(root).render(<App boot={data ?? {}} />);
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
