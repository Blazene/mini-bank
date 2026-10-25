import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, LoaderCircle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useBank } from '../context/Bank';
import { useSession } from '../context/Session';
import { demoHistory } from '../lib/demo';
import { errorMessage } from '../lib/api';
import type { History } from '../lib/types';
import { Transactions } from '../components/Transactions';
import { Empty, Notice, PageHeading, Spinner } from '../components/ui';
export function Activity() {
  const { accounts, preview, revision } = useBank(),
    { api } = useSession(),
    [params, setParams] = useSearchParams();
  const account = params.get('account') || '',
    type = params.get('type') || '';
  const [data, setData] = useState<History | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    if (preview) {
      setData({
        ...demoHistory,
        transactions: demoHistory.transactions.filter(
          (row) =>
            (!type || row.type === type) &&
            (!account || row.fromAccountId === account || row.toAccountId === account)
        ),
      });
      return;
    }
    const query = new URLSearchParams({
      limit: '10',
      ...(account ? { accountId: account } : {}),
      ...(type ? { type } : {}),
    });
    api
      .request<History>('GET', `/transactions?${query}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [api, preview, account, type, revision, refresh]);
  async function more() {
    if (!data?.pagination.nextCursor || busy) return;
    setBusy(true);
    setError('');
    const query = new URLSearchParams({
      limit: '10',
      cursor: data.pagination.nextCursor,
      ...(account ? { accountId: account } : {}),
      ...(type ? { type } : {}),
    });
    try {
      const page = await api.request<History>('GET', `/transactions?${query}`);
      setData((current) =>
        current
          ? {
              ...page,
              transactions: [
                ...current.transactions,
                ...page.transactions.filter(
                  (row) => !current.transactions.some((old) => old.id === row.id)
                ),
              ],
            }
          : page
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }
  return (
    <>
      <PageHeading
        eyebrow="THE FULLER PICTURE"
        title="Your activity, made clear."
        action={
          <button
            className="button button-secondary"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={busy}
          >
            <RefreshCw size={17} /> Refresh
          </button>
        }
      >
        A record of the little movements and bigger moments.
      </PageHeading>
      <section className="panel activity-panel">
        <div className="activity-filters">
          <span>
            <SlidersHorizontal size={18} />
            Filter activity
          </span>
          <label className="sr-only" htmlFor="activity-account">
            Filter by account
          </label>
          <select
            id="activity-account"
            value={account}
            onChange={(event) => filter('account', event.target.value)}
            disabled={busy}
          >
            <option value="">All your accounts</option>
            {accounts.map((item) => (
              <option value={item.id} key={item.id}>
                {item.type === 'savings' ? 'Savings' : 'Current'} · {item.accountNumber.slice(-4)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="activity-type">
            Filter by transaction type
          </label>
          <select
            id="activity-type"
            value={type}
            onChange={(event) => filter('type', event.target.value)}
            disabled={busy}
          >
            <option value="">All movements</option>
            <option value="deposit">Deposits</option>
            <option value="withdrawal">Withdrawals</option>
            <option value="transfer">Transfers</option>
          </select>
          {(account || type) && (
            <button className="button button-text" onClick={() => setParams({})} disabled={busy}>
              Clear filters
            </button>
          )}
        </div>
        {error && (
          <Notice>
            {error} <button onClick={() => setRefresh((value) => value + 1)}>Try again</button>
          </Notice>
        )}
        {!data && !error ? (
          <Spinner label="Finding your latest activity…" />
        ) : data?.transactions.length ? (
          <>
            <Transactions rows={data.transactions} />
            <div className="table-footer">
              <span>Showing {data.transactions.length} latest movements</span>
              {data.pagination.hasMore && (
                <button className="button button-secondary" onClick={more} disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDown size={16} />}{' '}
                  Load more
                </button>
              )}
            </div>
          </>
        ) : (
          !error && (
            <Empty title="Nothing here just yet">
              Try another filter, or make your first money movement.
            </Empty>
          )
        )}
      </section>
      <p className="page-footnote">
        Counterparty numbers are masked for privacy. Transfers between your own accounts are marked
        as internal.
      </p>
    </>
  );
}
