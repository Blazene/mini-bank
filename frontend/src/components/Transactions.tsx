import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react';
import { displayDate, formatMoney } from '../lib/money';
import type { Transaction } from '../lib/types';
export function Transactions({ rows }: { rows: Transaction[] }) {
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Transaction history, horizontally scrollable"
    >
      <table className="transaction-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Date</th>
            <th>Status</th>
            <th className="align-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="transaction-name">
                  <span className={`transaction-icon ${row.direction}`}>
                    {row.direction === 'credit' ? (
                      <ArrowDownLeft size={20} />
                    ) : row.direction === 'internal' ? (
                      <ArrowLeftRight size={20} />
                    ) : (
                      <ArrowUpRight size={20} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {row.description ||
                        (row.type === 'deposit'
                          ? 'Money added'
                          : row.type === 'withdrawal'
                            ? 'Withdrawal'
                            : 'Account transfer')}
                    </strong>
                    <span>
                      {row.type === 'transfer'
                        ? row.counterpartyAccountNumber || 'Between your accounts'
                        : row.type === 'deposit'
                          ? 'Deposit to your account'
                          : 'Withdrawal from your account'}
                    </span>
                    <span className="mobile-transaction-meta">
                      {displayDate(row.createdAt, true)} · {row.status}
                    </span>
                  </div>
                </div>
              </td>
              <td className="muted nowrap">{displayDate(row.createdAt, true)}</td>
              <td>
                <span className="status-badge">{row.status}</span>
              </td>
              <td className={`amount align-right ${row.direction === 'credit' ? 'positive' : ''}`}>
                {row.direction === 'credit' ? '+' : row.direction === 'debit' ? '−' : ''}
                {formatMoney(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
