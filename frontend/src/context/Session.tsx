import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApi, type Api } from '../lib/api';
import type { User } from '../lib/types';
type Session = {
  user: User | null;
  api: Api;
  expired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const token = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null),
    [expired, setExpired] = useState(false);
  const api = useMemo(
    () =>
      createApi(
        () => token.current,
        (sentToken) => {
          if (token.current === sentToken) {
            token.current = null;
            setUser(null);
            setExpired(true);
          }
        }
      ),
    []
  );
  const logout = () => {
    token.current = null;
    setUser(null);
    setExpired(false);
  };
  const login = async (email: string, password: string) => {
    const result = await api.request<{ token: string }>('POST', '/auth/login', {
      body: { email, password },
      token: null,
    });
    const current = await api.request<{ user: User }>('GET', '/auth/me', { token: result.token });
    token.current = result.token;
    setUser(current.user);
    setExpired(false);
  };
  return (
    <Context.Provider value={{ user, api, expired, login, logout }}>{children}</Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('Session provider missing');
  return value;
}
