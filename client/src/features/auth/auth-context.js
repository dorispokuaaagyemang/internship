import { createContext, useContext } from 'react';

// { status: 'loading' | 'signedOut' | 'signedIn', user, login, register, logout, setUser, reloadUser }
export const AuthContext = createContext(null);

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}

// Where each role lands after signing in.
export const HOME_BY_ROLE = {
  student: '/student',
  company_rep: '/company',
  supervisor: '/supervisor',
  admin: '/admin',
};

export const homeFor = (user) => HOME_BY_ROLE[user?.role] ?? '/';

// US-00B, US-01: an account becomes active once its phone (and, for a password account, its
// email) is verified. Until then the app only offers the verification screen.
export const needsVerification = (user) => Boolean(user) && user.status === 'pending';
