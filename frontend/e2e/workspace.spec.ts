import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // No browser test may accidentally write to the hosted API via the dev proxy.
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Unmocked test request' } } })
  );
});
const account = {
  id: '4ed0f125-a57e-4ad5-92b8-44a43afde804',
  accountNumber: '104200008426',
  type: 'savings',
  balance: 1000000,
  currency: 'INR',
  status: 'active',
  createdAt: '2026-10-25T10:00:00Z',
};
const user = {
  id: 'test-user',
  fullName: 'Jamie Customer',
  email: 'test@example.com',
  role: 'user',
};
async function mockSession(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/login'))
      return route.fulfill({ json: { token: 'test-only-token', user } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { user } });
    if (path.endsWith('/accounts')) return route.fulfill({ json: { accounts: [account] } });
    return route.fulfill({
      json: { transactions: [], pagination: { hasMore: false, nextCursor: null, limit: 10 } },
    });
  });
  await page.goto('/login');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('test-password1');
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
  await expect(page.getByRole('heading', { name: /A good day for clarity, Jamie/ })).toBeVisible();
  await expect(page.getByText('A clean slate')).toBeVisible();
}
test('preview is responsive, accessible, labeled, and never sends API requests', async ({
  page,
}, info) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) calls.push(request.url());
  });
  await page.goto('/demo/overview');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/viewing sample data/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))
  ).toEqual([]);
  expect(calls).toEqual([]);
  await page.screenshot({ path: `artifacts/overview-${info.project.name}.png`, fullPage: true });
});
test('auth design and protected routes work without browser storage', async ({ page }, info) => {
  await page.goto('/app/accounts');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.screenshot({ path: `artifacts/login-${info.project.name}.png`, fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    audit.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))
  ).toEqual([]);
  await mockSession(page);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))
  ).toEqual({ local: 0, session: 0 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});
test('account dialog has a keyboard escape and does not submit preview data', async ({ page }) => {
  await page.goto('/demo/accounts');
  const trigger = page.getByRole('button', { name: 'Open an account' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open savings account' })).toBeDisabled();
  const audit = await new AxeBuilder({ page })
    .include('dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test('an uncertain movement retries the same integer-paise body and key', async ({ page }) => {
  await mockSession(page);
  const attempts: { key: string | undefined; body: unknown }[] = [];
  await page.route('**/api/v1/transactions/transfer', async (route) => {
    attempts.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (attempts.length === 1) return route.abort('failed');
    return route.fulfill({
      status: 201,
      json: { transaction: { id: 'test-reference' }, account: { ...account, balance: 998950 } },
    });
  });
  await page.getByRole('link', { name: 'Move money', exact: true }).last().click();
  await page.getByLabel('Recipient account number').fill('104200003108');
  await page.getByRole('textbox', { name: 'Amount in rupees', exact: true }).fill('10.50');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await page.getByRole('button', { name: 'Confirm movement' }).click();
  await expect(page.getByText('The outcome isn’t confirmed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details' })).not.toBeVisible();
  const mobile = await page.getByRole('button', { name: 'Open navigation' }).isVisible();
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: /Jamie Customer/ })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/payments/);
  if (mobile) await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  await expect(page.getByRole('heading', { name: 'Your transfer is complete.' })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(attempts[0].key).toBeTruthy();
  expect(attempts[0].body).toMatchObject({ amount: 1050, toAccountNumber: '104200003108' });
});
test('activity preserves opaque cursors and resets paging on a filter change', async ({ page }) => {
  await mockSession(page);
  const cursor = 'opaque-2026-10-25T00:00:00.123456Z+/=',
    seen: URL[] = [];
  const row = {
    id: 'row-1',
    type: 'deposit',
    direction: 'credit',
    amount: 1050,
    status: 'completed',
    description: 'Test deposit',
    createdAt: '2026-10-25T10:00:00Z',
    counterpartyAccountNumber: null,
  };
  await page.route('**/api/v1/transactions?**', (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    return route.fulfill({
      json: {
        transactions: [{ ...row, id: url.searchParams.has('cursor') ? 'row-2' : 'row-1' }],
        pagination: { limit: 10, hasMore: !url.searchParams.has('cursor'), nextCursor: cursor },
      },
    });
  });
  await page.getByRole('link', { name: 'View all activity' }).click();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText('Showing 2 latest movements')).toBeVisible();
  expect(seen.some((url) => url.searchParams.get('cursor') === cursor)).toBe(true);
  await page.getByLabel('Filter by transaction type').selectOption('deposit');
  await expect(page.getByText('Showing 1 latest movements')).toBeVisible();
  expect(seen.at(-1)?.searchParams.get('type')).toBe('deposit');
  expect(seen.at(-1)?.searchParams.has('cursor')).toBe(false);
});

for (const view of ['accounts', 'payments', 'activity', 'loans']) {
  test(`${view} preview is accessible and fits the viewport`, async ({ page }, info) => {
    await page.goto(`/demo/${view}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      audit.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      }))
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/${view}-${info.project.name}.png`, fullPage: true });
  });
}

test('an expired API session returns to sign-in with no stale financial screen', async ({
  page,
}) => {
  await mockSession(page);
  await page.route('**/api/v1/transactions?**', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'TOKEN_EXPIRED', message: 'Expired' } } })
  );
  await page.getByRole('link', { name: 'View all activity' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByText(/Your session expired/)).toBeVisible();
});

test('loan quotes submit integer paise, save the application, and reset on edited terms', async ({
  page,
}) => {
  await mockSession(page);
  const quote = {
    principal: 10000000,
    tenureMonths: 12,
    annualRateBps: 1200,
    emi: 888488,
    totalInterest: 661856,
    totalRepayment: 10661856,
    eligibility: { eligible: true, reasons: [] },
    schedule: [],
  };
  const application = {
    id: '4ed0f125-a57e-4ad5-92b8-44a43afde804',
    principal: 10000000,
    tenureMonths: 12,
    status: 'pending',
    createdAt: '2026-10-25T10:00:00Z',
    review: null,
  };
  let submitted: unknown;
  await page.route('**/api/v1/loans/quote', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      principal: 10000000,
      monthlyIncome: 5000000,
      existingMonthlyEmi: 0,
      tenureMonths: 12,
    });
    return route.fulfill({ json: { quote } });
  });
  await page.route('**/api/v1/loans/applications', (route) => {
    submitted = route.request().postDataJSON();
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    return route.fulfill({ status: 201, json: { application } });
  });
  await page.getByRole('link', { name: 'Explore your options' }).click();
  await page.getByRole('button', { name: 'Calculate my quote' }).click();
  await expect(page.getByText('₹8,884.88', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit demo application' }).click();
  await expect(page.getByText('Application submitted.')).toBeVisible();
  await expect(page.locator('input[readonly]')).toHaveValue(application.id);
  expect(submitted).toMatchObject({ principal: 10000000, monthlyIncome: 5000000 });
  await page.getByLabel('Loan principal in rupees').fill('200000');
  await expect(page.getByRole('button', { name: 'Submit demo application' })).not.toBeVisible();
});
