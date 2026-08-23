// Host wrapper for the matchup builder.
//
// cityboys-matchup-builder.jsx is left exactly as written — this file supplies
// the two things it expects from its environment and nothing else:
//
//   1. a React root to render into
//   2. `window.storage`, the async key/value API it saves through
//
// The component is the source of truth; anything that needs changing should be
// changed there, not worked around here.
import { createRoot } from 'react-dom/client';
import CityBoysBuilder from '../cityboys-matchup-builder.jsx';

// The component was written against an async storage API. localStorage is
// synchronous and same-origin, so the shim is thin: match the shapes it reads
// (`res.value`), and let a full quota surface as a rejection, which is what its
// "Save failed / try a smaller image" paths already handle.
window.storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value === null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, String(value));   // throws when the quota is full
    return true;
  },
  async delete(key) {
    localStorage.removeItem(key);
    return true;
  },
};

createRoot(document.getElementById('root')).render(<CityBoysBuilder />);
