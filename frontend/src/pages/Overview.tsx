import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Landmark,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useBank } from '../context/Bank';
import { useSession } from '../context/Session';
import { demoHistory } from '../lib/demo';
import { errorMessage } from '../lib/api';
import { formatMoney, totalBalance } from '../lib/money';
import type { History } from '../lib/types';
import { Empty, Notice, PageHeading, Spinner } from '../components/ui';
import { Transactions } from '../components/Transactions';
export function Overview() {
  const { accounts, user, preview, prefix, loading, error, revision, refresh } = useBank(),
    { api } = useSession();
  const [history, setHistory] = useState<History | null>(preview ? demoHistory : null),
    [historyError, setHistoryError] = useState('');
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    setHistoryError('');
    api
      .request<History>('GET', '/transactions?limit=5', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setHistory(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setHistoryError(errorMessage(err));
      });
    return () => controller.abort();
  }, [api, preview, revision]);
  return (
    <>
      <PageHeading
        eyebrow="YOUR EVERYDAY, SIMPLIFIED"
        title={`A good day for clarity, ${user.fullName.split(' ')[0]}.`}
      >
        Here’s a little perspective on where you stand.
      </PageHeading>
      {error && (
        <Notice>
          {error} <button onClick={refresh}>Try again</button>
        </Notice>
      )}
      {loading && <Spinner />}
      <section className="overview-top">
        <div className="balance-card">
          <div className="balance-card-top">
            <span>
              <span className="balance-icon">
                <Wallet size={19} />
              </span>{' '}
              Total account balance
            </span>
            <span className="card-currency">INR</span>
          </div>
          <div className="hero-balance">
            {loading || error ? '—' : formatMoney(totalBalance(accounts))}
          </div>
          <p>
            Across {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}. All in one
            place.
          </p>
          <div className="balance-actions">
            <Link to={`${prefix}/payments`} className="button button-white">
              <ArrowUpRight size={18} /> Move money
            </Link>
            <Link to={`${prefix}/payments?type=deposit`} className="button button-ghost-light">
              <Plus size={18} /> Add money
            </Link>
          </div>
          <div className="balance-decoration" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="insight-card">
          <span className="small-icon">
            <Sparkles size={21} />
          </span>
          <div className="eyebrow">A LITTLE ROOM TO GROW</div>
          <h2>
            Big plans start
            <br />
            with a clear picture.
          </h2>
          <p>Explore a loan quote, understand the numbers and take the next step at your pace.</p>
          <Link to={`${prefix}/loans`} className="text-link">
            Explore your options <ArrowRight size={17} />
          </Link>
        </div>
      </section>
      <section className="summary-grid" aria-label="Account summary">
        <div className="summary-item">
          <span className="summary-icon">
            <Landmark size={21} />
          </span>
          <div>
            <small>Savings balance</small>
            <strong>
              {error || loading
                ? '—'
                : formatMoney(
                    totalBalance(accounts.filter((account) => account.type === 'savings'))
                  )}
            </strong>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon blue">
            <Wallet size={21} />
          </span>
          <div>
            <small>Current account balance</small>
            <strong>
              {error || loading
                ? '—'
                : formatMoney(
                    totalBalance(accounts.filter((account) => account.type === 'current'))
                  )}
            </strong>
          </div>
        </div>
        <div className="summary-item">
          <span className="summary-icon amber">
            <ShieldCheck size={21} />
          </span>
          <div>
            <small>Active accounts</small>
            <strong>
              {error || loading
                ? '—'
                : String(accounts.filter((account) => account.status === 'active').length).padStart(
                    2,
                    '0'
                  )}
              <span className="summary-detail"> ready for your everyday</span>
            </strong>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Your accounts</h2>
            <p>A place for your everyday. And what’s next.</p>
          </div>
          <Link to={`${prefix}/accounts`} className="text-link">
            Manage accounts <ArrowRight size={16} />
          </Link>
        </div>
        {!loading && !error && accounts.length === 0 ? (
          <Empty
            title="Make room for your first account"
            action={
              <Link className="button button-primary" to={`${prefix}/accounts`}>
                Open an account <Plus size={16} />
              </Link>
            }
          >
            A savings or current account is a simple place to begin.
          </Empty>
        ) : (
          <div className="account-preview-grid">
            {accounts.slice(0, 2).map((account, i) => (
              <Link
                className={`account-preview account-preview-${i}`}
                to={`${prefix}/accounts`}
                key={account.id}
              >
                <span className="account-preview-head">
                  <span>
                    <Landmark size={19} />
                    {account.type === 'savings' ? 'Everyday Savings' : 'Current Account'}
                  </span>
                  <ArrowUpRight size={18} />
                </span>
                <span className="account-number">
                  •••• &nbsp; •••• &nbsp; {account.accountNumber.slice(-4)}
                </span>
                <strong>{formatMoney(account.balance)}</strong>
                <span className="account-preview-bottom">
                  <span>Available balance</span>
                  <span className="account-status">{account.status}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="panel recent-panel">
        <div className="section-heading">
          <div>
            <h2>Recent activity</h2>
            <p>The latest movements, without the noise.</p>
          </div>
          <Link to={`${prefix}/activity`} className="text-link">
            View all activity <ArrowRight size={16} />
          </Link>
        </div>
        {historyError ? (
          <Notice>
            {historyError} <button onClick={refresh}>Try again</button>
          </Notice>
        ) : !history ? (
          <Spinner label="Loading recent activity…" />
        ) : history.transactions.length ? (
          <Transactions rows={history.transactions} />
        ) : (
          <Empty title="A clean slate">
            Your deposits, withdrawals and transfers will appear here.
          </Empty>
        )}
      </section>
      <div className="bottom-note">
        <ArrowDownLeft size={17} />
        <span>
          A small reminder: every amount here is simulated. Your next real step is learning.
        </span>
      </div>
    </>
  );
}
