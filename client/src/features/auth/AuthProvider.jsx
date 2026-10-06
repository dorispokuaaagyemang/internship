import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSessionChange, refreshSession, setSession } from '../../lib/api';
import { AuthContext } from './auth-context';

// Holds who is signed in. On load it tries the refresh cookie, so a page reload keeps the
// user signed in without storing any token in localStorage.
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    const unsubscribe = onSessionChange((session) =>
      setState(session ? { status: 'signedIn', user: session.user } : { status: 'signedOut', user: null }),
    );
    // A rejection just means "not signed in"; the listener above already recorded it.
    refreshSession().catch(() => {});
    return unsubscribe;
  }, []);

  const login = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    setSession(data);
    return data;
  }, []);

  const register = useCallback(async (details) => {
    const { data } = await api.post('/auth/register', details);
    setSession(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
      queryClient.clear();
    }
  }, [queryClient]);

  // For changes made elsewhere, e.g. the email confirmed in another tab: the token stays valid, only the user changes.
  const setUser = useCallback((user) => setState((s) => ({ ...s, user })), []);

  const reloadUser = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.user);
    return data.user;
  }, [setUser]);

  const value = useMemo(
    () => ({ ...state, login, register, logout, setUser, reloadUser }),
    [state, login, register, logout, setUser, reloadUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
