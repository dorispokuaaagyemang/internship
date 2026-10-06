import { Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { GuestOnly, RequireActive, RequireAuth, RequireRole } from './guards';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { VerifyPage } from './VerifyPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const apiFailure = (status, code, message, fields) => Object.assign(new Error(message), { response: { status, data: { error: { code, message, fields } } } });

beforeEach(() => vi.clearAllMocks());

describe('LoginPage', () => {
  it('validates before calling the API', async () => {
    const auth = makeAuth({ status: 'signedOut', user: null });
    renderApp(<LoginPage />, { route: '/login', path: '/login', auth });

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('US-01: an unverified email shows the reason and offers a new link', async () => {
    const auth = makeAuth({ status: 'signedOut', user: null });
    auth.login.mockRejectedValue(apiFailure(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in'));
    api.post.mockResolvedValue({ data: {} });
    renderApp(<LoginPage />, { route: '/login', path: '/login', auth });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret#123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Verify your email address before signing in')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    expect(api.post).toHaveBeenCalledWith('/auth/verify-email/resend', { email: 'ada@example.com' });
    expect(await screen.findByText(/A new link is on its way/)).toBeInTheDocument();
  });

  it('explains the outcome of an email link or Google sign-in', () => {
    renderApp(<LoginPage />, { route: '/login?error=google_denied', path: '/login', auth: makeAuth({ status: 'signedOut', user: null }) });
    expect(screen.getByText('Google sign-in was cancelled.')).toBeInTheDocument();
  });
});

describe('RegisterPage (US-01, US-04)', () => {
  it('applies the password and phone rules before sending', async () => {
    const auth = makeAuth({ status: 'signedOut', user: null });
    renderApp(<RegisterPage />, { route: '/register', path: '/register', auth });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password');
    await userEvent.type(screen.getByLabelText('Phone number'), '0712345678');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must contain at least one number')).toBeInTheDocument();
    expect(screen.getByText(/Include the country code/)).toBeInTheDocument();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('sends the chosen role and a tidy phone number, and shows server field errors', async () => {
    const auth = makeAuth({ status: 'signedOut', user: null });
    auth.register.mockRejectedValue(apiFailure(409, 'EMAIL_TAKEN', 'An account with this email already exists', { email: 'An account with this email already exists' }));
    renderApp(<RegisterPage />, { route: '/register', path: '/register', auth });

    await userEvent.click(screen.getByLabelText(/Registering a company/));
    await userEvent.type(screen.getByLabelText('Email'), 'rep@acme.co.ke');
    await userEvent.type(screen.getByLabelText('Password'), 'secret#123');
    await userEvent.type(screen.getByLabelText('Company contact phone'), '+254 712 345 678');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(auth.register).toHaveBeenCalledWith({ role: 'company_rep', email: 'rep@acme.co.ke', password: 'secret#123', phone: '+254712345678' }),
    );
    expect(await screen.findAllByText('An account with this email already exists')).not.toHaveLength(0);
  });
});

describe('VerifyPage (US-01)', () => {
  const pending = () =>
    makeAuth({ user: { id: 7, email: 'ada@example.com', role: 'student', status: 'pending', phoneE164: '+254712345678', emailVerifiedAt: null } });

  it('asks only for the email link (no SMS step) and can resend it', async () => {
    api.post.mockResolvedValue({ data: {} });
    renderApp(<VerifyPage />, { route: '/verify', path: '/verify', auth: pending() });

    expect(screen.getByRole('heading', { name: 'Confirm your email address' })).toBeInTheDocument();
    expect(screen.queryByText(/code/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resend the link' }));
    expect(api.post).toHaveBeenCalledWith('/auth/verify-email/resend', { email: 'ada@example.com' });
    expect(await screen.findByText(/A new link is on its way/)).toBeInTheDocument();
  });

  it('re-checks the account when the user says they have confirmed it', async () => {
    const auth = pending();
    renderApp(<VerifyPage />, { route: '/verify', path: '/verify', auth });

    await userEvent.click(screen.getByRole('button', { name: 'I have confirmed it' }));
    await waitFor(() => expect(auth.reloadUser).toHaveBeenCalledTimes(2)); // on load, then on click
  });

  it('lets an active account continue to its home', () => {
    renderApp(<VerifyPage />, { route: '/verify', path: '/verify' });
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/student');
  });
});

describe('route guards', () => {
  const tree = (
    <Route element={<RequireAuth />}>
      <Route element={<RequireActive />}>
        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin" element={<p>admin area</p>} />
        </Route>
      </Route>
    </Route>
  );

  it('sends a signed-out visitor to login, remembering where they were going', () => {
    renderApp(tree, { route: '/admin', auth: makeAuth({ status: 'signedOut', user: null }) });
    expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fadmin');
  });

  it('US-00B: sends a pending account to verification', () => {
    renderApp(tree, { route: '/admin', auth: makeAuth({ user: { id: 1, role: 'admin', status: 'pending' } }) });
    expect(screen.getByTestId('location')).toHaveTextContent('/verify');
  });

  it("sends another role to its own home", () => {
    renderApp(tree, { route: '/admin' });
    expect(screen.getByTestId('location')).toHaveTextContent('/student');
  });

  it('lets the right role in', () => {
    renderApp(tree, { route: '/admin', auth: makeAuth({ user: { id: 1, role: 'admin', status: 'active' } }) });
    expect(screen.getByText('admin area')).toBeInTheDocument();
  });

  it('sends a signed-in user away from login, honouring only same-site ?next=', () => {
    const guest = (
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<p>login</p>} />
      </Route>
    );
    renderApp(guest, { route: '/login?next=%2Fnotifications' });
    expect(screen.getByTestId('location')).toHaveTextContent('/notifications');
  });

  it('ignores an off-site ?next=', () => {
    const guest = (
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<p>login</p>} />
      </Route>
    );
    renderApp(guest, { route: '/login?next=%2F%2Fevil.example' });
    expect(screen.getByTestId('location')).toHaveTextContent('/student');
  });
});
