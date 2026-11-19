import { useEffect, useState } from 'react';
import { api } from './api.js';

export function useApi(path) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true }));
    api(path).then((data) => live && set({ data, error: null, loading: false }))
      .catch((error) => live && set({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [path]);
  return state;
}
