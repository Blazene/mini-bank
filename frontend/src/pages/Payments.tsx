import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { useBank } from '../context/Bank';
import { formatMoney, parseRupees } from '../lib/money';
import { useSafeWrite } from '../lib/useSafeWrite';
import { errorMessage } from '../lib/api';
import { Empty, Notice, PageHeading } from '../components/ui';
import type { Account } from '../lib/types';
type Movement = 'transfer' | 'deposit' | 'withdraw';
function MoveForm({ type, onLocked }: { type: Movement; onLocked: (locked: boolean) => void }) {
  const { accounts, preview, prefix, refresh } = useBank();
  const [accountId, setAccountId] = useState(''),
    [amount, setAmount] = useState(''),
    [recipient, setRecipient] = useState(''),
    [description, setDescription] = useState(''),
    [validation, setValidation] = useState('');
  const [review, setReview] = useState<{
    path: string;
    body: Record<string, unknown>;
    amount: number;
  } | null>(null);
  const write = useSafeWrite<{ transaction: { id: string }; account: Account }>();
  useEffect(() => {
    onLocked(write.locked);
    return () => onLocked(false);
  }, [write.locked, onLocked]);
  const active = accounts.filter((account) => account.status === 'active'),
    selected = active.find((account) => account.id === (accountId || active[0]?.id));
  function prepare(event: FormEvent) {
    event.preventDefault();
    setValidation('');
    try {
      if (!selected) throw new Error('Choose an active account.');
      const paise = parseRupees(amount);
      if (type === 'transfer' && !/^[1-9]\d{11}$/.test(recipient))
        throw new Error('Enter a 12-digit recipient account number.');
      if (type === 'transfer' && recipient === selected.accountNumber)
        throw new Error('Choose a different recipient account.');
      if (type !== 'deposit' && paise > selected.balance)
        throw new Error('This amount is more than the selected account’s available balance.');
      const body =
        type === 'transfer'
          ? {
              fromAccountId: selected.id,
              toAccountNumber: recipient,
              amount: paise,
              description: description.trim(),
            }
          : { accountId: selected.id, amount: paise, description: description.trim() };
      setReview({ path: `/transactions/${type}`, body, amount: paise });
    } catch (err) {
      setValidation(errorMessage(err));
    }
  }
  async function confirm() {
    if (!review || preview) return;
    const result = await write.submit(review.path, review.body);
    if (result) refresh();
  }
  if (write.result)
    return (
      <div className="payment-success">
        <span>
          <CheckCircle2 size={35} />
        </span>
        <div className="eyebrow">ALL TAKEN CARE OF</div>
        <h2>
          {type === 'transfer'
            ? 'Your transfer is complete.'
            : type === 'deposit'
              ? 'A little more in your account.'
              : 'Your withdrawal is complete.'}
        </h2>
        <strong>{formatMoney(review!.amount)}</strong>
        <p>Confirmed by the API. Account balances have been refreshed.</p>
        <div className="receipt-id">
          <small>TRANSACTION REFERENCE</small>
          <code>{write.result.transaction.id}</code>
        </div>
        <div className="button-row">
          <button
            className="button button-primary"
            onClick={() => {
              write.reset();
              setReview(null);
              setAmount('');
              setDescription('');
            }}
          >
            Make another movement
          </button>
          <Link className="button button-secondary" to={`${prefix}/activity`}>
            View activity
          </Link>
        </div>
      </div>
    );
  if (!active.length)
    return (
      <Empty
        title="Start with an active account"
        action={
          <Link className="button button-primary" to={`${prefix}/accounts`}>
            Explore accounts <ArrowRight size={16} />
          </Link>
        }
      >
        You’ll need an active account before moving demo money.
      </Empty>
    );
  return (
    <>
      {preview && (
        <Notice tone="info">
          You’re in preview. Forms are interactive, but no money movement can be submitted. Sign in
          for the live demo.
        </Notice>
      )}
      {validation && <Notice>{validation}</Notice>}
      {write.error && <Notice>{write.error}</Notice>}
      {write.uncertain && (
        <Notice tone="info">
          <strong>The outcome isn’t confirmed.</strong> Keep this page open. Retry the exact same
          request below, or check activity before starting a new movement. The saved retry key
          prevents double-processing.
        </Notice>
      )}
      {write.retrySeconds > 0 && (
        <Notice tone="info">
          Please wait {write.retrySeconds} seconds before retrying. We won’t submit automatically.
        </Notice>
      )}
      {review ? (
        <div className="payment-review">
          <div className="review-icon">
            <ShieldCheck size={28} />
          </div>
          <h2>A quick check, then you’re set.</h2>
          <p>
            Review your{' '}
            {type === 'transfer' ? 'transfer' : type === 'deposit' ? 'deposit' : 'withdrawal'}{' '}
            before confirming.
          </p>
          <div className="review-amount">{formatMoney(review.amount)}</div>
          <dl className="detail-list">
            <div>
              <dt>{type === 'deposit' ? 'To account' : 'From account'}</dt>
              <dd>•••• {selected?.accountNumber.slice(-4)}</dd>
            </div>
            {type === 'transfer' && (
              <div>
                <dt>Recipient number</dt>
                <dd>{recipient}</dd>
              </div>
            )}
            <div>
              <dt>Note</dt>
              <dd>{description.trim() || 'No note added'}</dd>
            </div>
          </dl>
          {type === 'transfer' && (
            <p className="form-hint">
              There is no recipient-name lookup. Double-check the account number; successful
              transfers cannot be reversed through this demo.
            </p>
          )}
          <button
            className="button button-primary full-width"
            onClick={confirm}
            disabled={write.busy || preview || write.retrySeconds > 0}
          >
            {write.busy ? (
              <>
                <LoaderCircle size={18} className="spin" /> Confirming…
              </>
            ) : (
              <>
                {write.uncertain ? 'Retry the same request' : 'Confirm movement'}{' '}
                <Check size={18} />
              </>
            )}
          </button>
          {!write.locked && (
            <button
              className="button button-text full-width"
              onClick={() => {
                setReview(null);
                write.reset();
              }}
            >
              Edit details
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={prepare} className="form-stack payment-form">
          <label>
            {type === 'deposit' ? 'Add money to' : 'Move money from'}
            <select
              value={selected?.id || ''}
              onChange={(event) => setAccountId(event.target.value)}
              required
            >
              {active.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.type === 'savings' ? 'Savings' : 'Current'} ·{' '}
                  {account.accountNumber.slice(-4)} · {formatMoney(account.balance)}
                </option>
              ))}
            </select>
          </label>
          {type === 'transfer' && (
            <label>
              Recipient account number
              <input
                inputMode="numeric"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Enter 12-digit account number"
                autoComplete="off"
                maxLength={12}
                required
              />
            </label>
          )}
          <label>
            Amount in rupees
            <div className="currency-input">
              <span>₹</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                required
                aria-label="Amount in rupees"
              />
              <span>INR</span>
            </div>
            <small className="field-hint">
              Up to ₹1,00,00,000.00 per movement. Whole paise only.
            </small>
          </label>
          <label>
            A note, if you’d like <span className="optional">Optional</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={140}
              placeholder="What’s this for?"
            />
          </label>
          <button className="button button-primary">
            Review{' '}
            {type === 'transfer' ? 'transfer' : type === 'deposit' ? 'deposit' : 'withdrawal'}{' '}
            <ArrowRight size={18} />
          </button>
          <p className="form-hint">
            You’ll review everything before confirming. This is simulated money only.
          </p>
        </form>
      )}
    </>
  );
}
export function Payments() {
  const [params, setParams] = useSearchParams(),
    [locked, setLocked] = useState(false);
  const type: Movement =
    params.get('type') === 'deposit'
      ? 'deposit'
      : params.get('type') === 'withdraw'
        ? 'withdraw'
        : 'transfer';
  return (
    <>
      <PageHeading eyebrow="MAKE ROOM FOR WHAT MATTERS" title="Money, on the move.">
        A simple way to move funds between demo accounts.
      </PageHeading>
      <div className="payments-layout">
        <section className="panel payment-panel">
          <div className="tabs" aria-label="Movement type">
            {(
              [
                { value: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
                { value: 'deposit', label: 'Deposit', icon: ArrowDownLeft },
                { value: 'withdraw', label: 'Withdraw', icon: ArrowUpRight },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={type === value ? 'active' : ''}
                aria-pressed={type === value}
                disabled={locked}
                onClick={() => setParams({ type: value })}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
          <MoveForm key={type} type={type} onLocked={setLocked} />
        </section>
        <aside className="payment-aside">
          <span className="small-icon">
            <ShieldCheck size={24} />
          </span>
          <h2>Thoughtful by design.</h2>
          <div className="assurance-item">
            <span>01</span>
            <div>
              <strong>Every detail, reviewed.</strong>
              <p>Check the amount and recipient before anything is sent.</p>
            </div>
          </div>
          <div className="assurance-item">
            <span>02</span>
            <div>
              <strong>One intent. One movement.</strong>
              <p>Uncertain response? The same request can be retried without paying twice.</p>
            </div>
          </div>
          <div className="assurance-item">
            <span>03</span>
            <div>
              <strong>Your balance stays honest.</strong>
              <p>Balances and transaction records are updated together, or not at all.</p>
            </div>
          </div>
          <div className="aside-footnote">
            This workspace has no connection to real bank accounts or payment networks.
          </div>
        </aside>
      </div>
    </>
  );
}
