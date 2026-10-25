import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Copy, Eye, EyeOff, Landmark, LoaderCircle, Plus } from 'lucide-react';
import { useBank } from '../context/Bank';
import { useSession } from '../context/Session';
import { ApiError, errorMessage } from '../lib/api';
import { displayDate, formatMoney } from '../lib/money';
import type { Account } from '../lib/types';
import { Dialog, Empty, Notice, PageHeading, Spinner } from '../components/ui';
function AccountCard({ account }: { account: Account }) {
  const { prefix } = useBank();
  const [visible, setVisible] = useState(false),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(account.accountNumber);
      setCopied(true);
    } catch {
      setCopyError('Clipboard unavailable. Reveal the account number to copy it manually.');
    }
  }
  return (
    <article className="panel account-detail">
      <div className="account-detail-top">
        <span className={`summary-icon ${account.type === 'current' ? 'blue' : ''}`}>
          <Landmark size={24} />
        </span>
        <span className={`status-badge ${account.status === 'active' ? '' : 'status-neutral'}`}>
          {account.status}
        </span>
      </div>
      <h2>{account.type === 'savings' ? 'Everyday Savings' : 'Current Account'}</h2>
      <p>
        {account.type === 'savings'
          ? 'A little space for what’s next.'
          : 'Ready for your everyday flow.'}
      </p>
      <div className="account-detail-balance">
        <small>ACCOUNT BALANCE</small>
        <strong>{formatMoney(account.balance)}</strong>
      </div>
      <div className="account-identity">
        <div>
          <small>Account number</small>
          <strong>
            {visible ? account.accountNumber : `•••• •••• ${account.accountNumber.slice(-4)}`}
          </strong>
        </div>
        <button
          className="icon-button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? 'Hide' : 'Reveal'} account ending ${account.accountNumber.slice(-4)}`}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
        <button
          className="icon-button"
          onClick={copy}
          aria-label={`Copy account ending ${account.accountNumber.slice(-4)}`}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
      {copied && (
        <span className="form-hint" role="status">
          Account number copied.
        </span>
      )}
      {copyError && <Notice>{copyError}</Notice>}
      <div className="account-meta">
        <span>Opened {displayDate(account.createdAt)}</span>
        <strong>{account.currency}</strong>
      </div>
      <Link
        className="button button-secondary full-width"
        to={`${prefix}/activity?account=${account.id}`}
      >
        View account activity <ArrowUpRight size={17} />
      </Link>
    </article>
  );
}
function OpenAccount({ onClose }: { onClose: () => void }) {
  const { preview, refresh } = useBank(),
    { api } = useSession();
  const [type, setType] = useState('savings'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || preview || uncertain) return;
    setBusy(true);
    setError('');
    try {
      await api.request('POST', '/accounts', { body: { type } });
      refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setUncertain(!(err instanceof ApiError) || err.uncertain);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="A new place for your money" onClose={onClose} busy={busy}>
      <p className="dialog-intro">
        Choose an account that fits your everyday. No real money or bank services are involved.
      </p>
      {preview && (
        <Notice tone="info">Preview only. Sign in to create an account on the live demo.</Notice>
      )}
      {error && <Notice>{error}</Notice>}
      {uncertain && (
        <Notice tone="info">
          Account creation may have completed. Check your accounts before opening another one. This
          endpoint cannot safely be auto-retried.
        </Notice>
      )}
      <form onSubmit={submit} className="form-stack">
        <div className="account-choices">
          {['savings', 'current'].map((value) => (
            <label key={value} className={type === value ? 'selected' : ''}>
              <input
                type="radio"
                name="account-type"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
                disabled={busy || uncertain}
              />
              <Landmark size={24} />
              <strong>{value === 'savings' ? 'Savings' : 'Current'}</strong>
              <span>
                {value === 'savings'
                  ? 'Keep your next chapter in mind.'
                  : 'A home for everyday movements.'}
              </span>
            </label>
          ))}
        </div>
        {uncertain ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              refresh();
              onClose();
            }}
          >
            Check my accounts
          </button>
        ) : (
          <button className="button button-primary" disabled={busy || preview}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />} Open {type}{' '}
            account
          </button>
        )}
      </form>
    </Dialog>
  );
}
export function Accounts() {
  const { accounts, loading, error, refresh } = useBank();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="A PLACE FOR EVERY PLAN"
        title="Your accounts."
        action={
          <button className="button button-primary" onClick={() => setOpen(true)}>
            <Plus size={18} /> Open an account
          </button>
        }
      >
        Everyday spending or your next big step. Keep it all in perspective.
      </PageHeading>
      {error && (
        <Notice>
          {error} <button onClick={refresh}>Try again</button>
        </Notice>
      )}
      {loading ? (
        <Spinner />
      ) : accounts.length ? (
        <div className="accounts-grid">
          {accounts.map((account) => (
            <AccountCard account={account} key={account.id} />
          ))}
        </div>
      ) : (
        !error && (
          <div className="panel">
            <Empty
              title="Your first account is a fresh start"
              action={
                <button className="button button-primary" onClick={() => setOpen(true)}>
                  Open an account <Plus size={17} />
                </button>
              }
            >
              Choose savings or current. Every new account starts at zero.
            </Empty>
          </div>
        )
      )}
      <div className="info-strip">
        <Landmark size={20} />
        <p>
          Account numbers belong to this educational demo only. They cannot receive real bank
          payments.
        </p>
      </div>
      {open && <OpenAccount onClose={() => setOpen(false)} />}
    </>
  );
}
