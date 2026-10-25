export type User = { id: string; email: string; fullName: string; role: 'user' | 'admin' };
export type Account = {
  id: string;
  accountNumber: string;
  type: 'savings' | 'current';
  balance: number;
  currency: 'INR';
  status: 'active' | 'frozen' | 'closed';
  createdAt: string;
};
export type Transaction = {
  id: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  direction: 'credit' | 'debit' | 'internal';
  amount: number;
  status: string;
  description: string | null;
  createdAt: string;
  counterpartyAccountNumber: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
};
export type History = {
  transactions: Transaction[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
};
export type LoanInput = {
  principal: number;
  tenureMonths: number;
  monthlyIncome: number;
  existingMonthlyEmi: number;
};
export type Quote = {
  principal: number;
  tenureMonths: number;
  annualRateBps: number;
  emi: number;
  totalInterest: number;
  totalRepayment: number;
  eligibility: { eligible: boolean; reasons: string[]; maxMonthlyDebt: number };
  schedule: {
    month: number;
    payment: number;
    principal: number;
    interest: number;
    balance: number;
  }[];
};
export type Application = LoanInput & {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  quote: Quote;
  createdAt: string;
  review: { reason: string; reviewedAt: string } | null;
};
