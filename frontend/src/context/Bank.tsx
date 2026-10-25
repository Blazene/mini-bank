import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from './Session';
import { demoAccounts, demoUser } from '../lib/demo';
import { errorMessage } from '../lib/api';
import type { Account, Application, User } from '../lib/types';
type Bank = {
  preview: boolean;
  user: User;
  accounts: Account[];
  loading: boolean;
  error: string;
  revision: number;
  refresh: () => void;
  applications: Application[];
  remember: (application: Application) => void;
  prefix: string;
  navigationLocked: boolean;
  setNavigationLocked: (locked: boolean) => void;
};
const Context = createContext<Bank | null>(null);
export function BankProvider({ children }: { children: ReactNode }) {
  const { user, api } = useSession(),
    { pathname } = useLocation(),
    preview = pathname.startsWith('/demo');
  const [accounts, setAccounts] = useState<Account[]>([]),
    [loading, setLoading] = useState(!preview),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [applications, setApplications] = useState<Application[]>([]);
  const [navigationLocked, setNavigationLocked] = useState(false);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api
      .request<{ accounts: Account[] }>('GET', '/accounts', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setAccounts(result.accounts);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, preview, revision]);
  const remember = (application: Application) =>
    setApplications((current) => [
      application,
      ...current.filter((item) => item.id !== application.id),
    ]);
  return (
    <Context.Provider
      value={{
        preview,
        user: preview ? demoUser : user!,
        accounts: preview ? demoAccounts : accounts,
        loading,
        error,
        revision,
        refresh,
        applications,
        remember,
        prefix: preview ? '/demo' : '/app',
        navigationLocked,
        setNavigationLocked,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useBank() {
  const value = useContext(Context);
  if (!value) throw new Error('Bank provider missing');
  return value;
}
