import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRoutes } from './App';
afterEach(() => vi.unstubAllGlobals());
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}
it.each(['/demo/overview', '/demo/accounts', '/demo/payments', '/demo/activity', '/demo/loans'])(
  'renders the labeled preview with no API calls: %s',
  async (path) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.getByText(/You’re viewing sample data/)).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it('guards private pages and offers an explicit preview link', () => {
  renderAt('/app/accounts');
  expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(screen.getByRole('link', { name: /Explore preview/ })).toHaveAttribute(
    'href',
    '/demo/overview'
  );
});
it('does not create an account from the preview dialog', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  renderAt('/demo/accounts');
  fireEvent.click(screen.getByRole('button', { name: /Open an account/ }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('button', { name: /Open savings account/ })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});
it('opens a real session via login and current-user, with a genuine empty state and no local storage', async () => {
  const user = { id: 'u1', email: 'fake@example.com', fullName: 'Test Customer', role: 'user' };
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/login')) return Response.json({ token: 'private-test-token', user });
    if (url.endsWith('/auth/me')) return Response.json({ user });
    if (url.endsWith('/accounts')) return Response.json({ accounts: [] });
    return Response.json({ transactions: [], pagination: { hasMore: false, nextCursor: null } });
  });
  vi.stubGlobal('fetch', fetcher);
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  renderAt('/login');
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fake-password1' } });
  fireEvent.click(screen.getByRole('button', { name: /Sign in to/ }));
  expect(
    await screen.findByRole('heading', { name: /A good day for clarity, Test/ })
  ).toBeVisible();
  await waitFor(() => expect(screen.getByText('Make room for your first account')).toBeVisible());
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});
