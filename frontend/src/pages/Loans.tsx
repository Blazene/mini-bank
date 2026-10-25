import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  FileText,
  LoaderCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import { useBank } from '../context/Bank';
import { useSession } from '../context/Session';
import { errorMessage } from '../lib/api';
import { displayDate, formatMoney, parseRupees } from '../lib/money';
import { useSafeWrite } from '../lib/useSafeWrite';
import type { Application, LoanInput, Quote } from '../lib/types';
import { Notice, PageHeading } from '../components/ui';
export function Loans() {
  const { preview, applications, remember } = useBank(),
    { api } = useSession();
  const [principal, setPrincipal] = useState('100000'),
    [income, setIncome] = useState('50000'),
    [existing, setExisting] = useState('0'),
    [months, setMonths] = useState('12');
  const [quote, setQuote] = useState<Quote | null>(null),
    [quotedInput, setQuotedInput] = useState<LoanInput | null>(null),
    [quoting, setQuoting] = useState(false),
    [error, setError] = useState('');
  const [lookupId, setLookupId] = useState(''),
    [lookupBusy, setLookupBusy] = useState(false),
    [lookupError, setLookupError] = useState('');
  const write = useSafeWrite<{ application: Application }>();
  const locked = quoting || write.locked;
  function change(update: () => void) {
    update();
    setQuote(null);
    setQuotedInput(null);
    write.reset();
  }
  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (preview || locked) return;
    setError('');
    try {
      const input = {
        principal: parseRupees(principal, { max: 100_000_000 }),
        tenureMonths: Number(months),
        monthlyIncome: parseRupees(income, { max: 100_000_000 }),
        existingMonthlyEmi: parseRupees(existing, { max: 100_000_000, allowZero: true }),
      };
      if (
        input.principal < 100_000 ||
        !Number.isInteger(input.tenureMonths) ||
        input.tenureMonths < 6 ||
        input.tenureMonths > 360
      )
        throw new Error('Choose a principal of ₹1,000–₹10,00,000 and a term of 6–360 months.');
      setQuoting(true);
      const result = await api.request<{ quote: Quote }>('POST', '/loans/quote', { body: input });
      setQuote(result.quote);
      setQuotedInput(input);
      write.reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setQuoting(false);
    }
  }
  async function apply() {
    if (!quotedInput || preview) return;
    const result = await write.submit('/loans/applications', quotedInput);
    if (result) remember(result.application);
  }
  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (preview || lookupBusy) return;
    setLookupError('');
    if (
      !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(lookupId.trim())
    ) {
      setLookupError('Enter a valid application UUID.');
      return;
    }
    setLookupBusy(true);
    try {
      const result = await api.request<{ application: Application }>(
        'GET',
        `/loans/applications/${lookupId.trim()}`
      );
      remember(result.application);
      setLookupId('');
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setLookupBusy(false);
    }
  }
  return (
    <>
      <PageHeading eyebrow="YOUR NEXT CHAPTER" title="Make room for bigger plans.">
        Understand the numbers before taking the next step.
      </PageHeading>
      {preview && (
        <Notice tone="info">
          Preview only. The illustrative quote is for ₹1,00,000 over 12 months. Sign in to calculate
          or submit a real demo application.
        </Notice>
      )}
      <div className="loan-layout">
        <section className="panel loan-form-panel">
          <div className="section-heading">
            <div>
              <h2>A little planning goes a long way.</h2>
              <p>A transparent quote at a fixed 12% annual nominal rate.</p>
            </div>
          </div>
          {error && <Notice>{error}</Notice>}
          <form onSubmit={calculate} className="form-stack">
            <label>
              How much would you like to explore?
              <div className="currency-input">
                <span>₹</span>
                <input
                  aria-label="Loan principal in rupees"
                  inputMode="decimal"
                  value={principal}
                  onChange={(event) => change(() => setPrincipal(event.target.value))}
                  disabled={locked}
                  required
                />
              </div>
              <small className="field-hint">₹1,000 to ₹10,00,000</small>
            </label>
            <div className="form-columns">
              <label>
                Repayment term
                <select
                  value={months}
                  onChange={(event) => change(() => setMonths(event.target.value))}
                  disabled={locked}
                >
                  {[6, 12, 24, 36, 60, 120, 240, 360].map((value) => (
                    <option key={value} value={value}>
                      {value} months
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Monthly income (₹)
                <input
                  inputMode="decimal"
                  value={income}
                  onChange={(event) => change(() => setIncome(event.target.value))}
                  disabled={locked}
                  required
                />
              </label>
            </div>
            <label>
              Existing monthly EMI (₹)
              <input
                inputMode="decimal"
                value={existing}
                onChange={(event) => change(() => setExisting(event.target.value))}
                disabled={locked}
                required
              />
              <small className="field-hint">Enter 0 if you don’t have an existing EMI.</small>
            </label>
            <button className="button button-primary" disabled={locked || preview}>
              {quoting ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{' '}
              Calculate my quote
            </button>
          </form>
          <div className="loan-disclaimer">
            <CircleHelp size={18} />
            <p>
              Eligibility is indicative and based on declared income, not a credit assessment.
              Approval never disburses funds in this demo.
            </p>
          </div>
        </section>
        <section className="loan-quote-panel">
          <div className="eyebrow">A CLEARER PICTURE</div>
          <h2>
            {quote || preview ? 'Here’s what that could look like.' : 'Your next step, in numbers.'}
          </h2>
          <p>
            {quote
              ? 'Calculated by the API, with exact paise rounding.'
              : 'No guesswork. A detailed quote to help you plan.'}
          </p>
          <div className="quote-amount">
            <small>{preview ? 'ILLUSTRATIVE MONTHLY EMI' : 'MONTHLY EMI'}</small>
            <strong>{quote ? formatMoney(quote.emi) : preview ? '₹8,884.88' : '₹—'}</strong>
            <span>per month</span>
          </div>
          {quote ? (
            <>
              <dl className="detail-list">
                <div>
                  <dt>Principal</dt>
                  <dd>{formatMoney(quote.principal)}</dd>
                </div>
                <div>
                  <dt>Total interest</dt>
                  <dd>{formatMoney(quote.totalInterest)}</dd>
                </div>
                <div>
                  <dt>Total repayment</dt>
                  <dd>{formatMoney(quote.totalRepayment)}</dd>
                </div>
                <div>
                  <dt>Term / annual rate</dt>
                  <dd>
                    {quote.tenureMonths} months / {quote.annualRateBps / 100}%
                  </dd>
                </div>
              </dl>
              <Notice tone={quote.eligibility.eligible ? 'success' : 'info'}>
                {quote.eligibility.eligible
                  ? 'Indicatively eligible under the demo policy.'
                  : quote.eligibility.reasons
                      .map((reason) =>
                        reason === 'INCOME_BELOW_MINIMUM'
                          ? 'Monthly income must be at least ₹15,000.'
                          : 'Proposed payments and existing EMI exceed 40% of income.'
                      )
                      .join(' ')}
              </Notice>
              {write.error && <Notice>{write.error}</Notice>}
              {write.uncertain && (
                <Notice tone="info">
                  The application outcome is unconfirmed. Keep this page open and retry the same
                  saved application, rather than starting a new one.
                </Notice>
              )}
              {write.result ? (
                <Notice tone="success">
                  <strong>Application submitted.</strong> It’s pending an admin decision. Save its
                  ID from the section below.
                </Notice>
              ) : (
                quote.eligibility.eligible && (
                  <button
                    className="button button-primary full-width"
                    disabled={write.busy || write.retrySeconds > 0}
                    onClick={apply}
                  >
                    {write.busy ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <FileText size={18} />
                    )}
                    {write.retrySeconds > 0
                      ? `Retry in ${write.retrySeconds}s`
                      : write.uncertain
                        ? 'Retry the same application'
                        : 'Submit demo application'}
                  </button>
                )
              )}
            </>
          ) : (
            <div className="quote-placeholder">
              <span>
                <CheckCircle2 size={17} /> 12% annual nominal interest
              </span>
              <span>
                <CheckCircle2 size={17} /> Transparent, saved terms
              </span>
              <span>
                <CheckCircle2 size={17} /> No real loan disbursement
              </span>
            </div>
          )}
        </section>
      </div>
      <section className="panel application-panel">
        <div className="section-heading">
          <div>
            <h2>Your applications</h2>
            <p>
              Applications opened in this session. Save the ID to find one after signing in again.
            </p>
          </div>
        </div>
        <form className="application-lookup" onSubmit={lookup}>
          <label className="sr-only" htmlFor="application-id">
            Find an application by ID
          </label>
          <Search size={18} />
          <input
            id="application-id"
            placeholder="Find an application by ID"
            value={lookupId}
            onChange={(event) => setLookupId(event.target.value)}
            required
            disabled={lookupBusy || preview}
          />
          <button className="button button-secondary" disabled={lookupBusy || preview}>
            {lookupBusy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}{' '}
            Find application
          </button>
        </form>
        {lookupError && <Notice>{lookupError}</Notice>}
        {applications.map((application) => (
          <article className="application-card" key={application.id}>
            <div className="application-title">
              <span className="summary-icon">
                <FileText size={21} />
              </span>
              <div>
                <h3>
                  {formatMoney(application.principal)} · {application.tenureMonths} months
                </h3>
                <small>Submitted {displayDate(application.createdAt)}</small>
              </div>
              <span
                className={`status-badge ${application.status === 'approved' ? '' : 'status-neutral'}`}
              >
                {application.status}
              </span>
            </div>
            <label>
              Application ID
              <input readOnly value={application.id} onFocus={(event) => event.target.select()} />
            </label>
            {application.review && (
              <p className="review-reason">
                <strong>Review note:</strong> {application.review.reason}
              </p>
            )}
          </article>
        ))}
        {!applications.length && (
          <div className="application-empty">
            <FileText size={25} />
            <p>
              {preview
                ? 'No applications have been sent. This is a preview workspace.'
                : 'Your submitted or looked-up applications will appear here.'}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
