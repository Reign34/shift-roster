import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api';

// Context so the signed-in user is reachable from anywhere without being
// passed down through every component in between.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // 'checking' matters. On a refresh there is a token in localStorage but no
  // user yet, and without this third state the app would flash the login
  // screen for a moment before deciding you were signed in after all.
  const [status, setStatus] = useState(getToken() ? 'checking' : 'signed-out');

  useEffect(() => {
    if (status !== 'checking') return;

    const controller = new AbortController();

    api.me(controller.signal)
      .then(({ user }) => { setUser(user); setStatus('signed-in'); })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setToken(null);              // expired or tampered with
        setStatus('signed-out');
      });

    return () => controller.abort();
  }, [status]);

  async function signIn(email, password) {
    const { user, token } = await api.login(email, password);
    setToken(token);
    setUser(user);
    setStatus('signed-in');
  }

  function signOut() {
    setToken(null);
    setUser(null);
    setStatus('signed-out');
  }

  return (
    <AuthContext.Provider value={{ user, status, signIn, signOut, isManager: user?.role === 'manager' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
