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
import { ForgotPasswordPage, ResetPasswordPage } from './PasswordResetPages';

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

  it('shows and hides the typed password', async () => {
    renderApp(<LoginPage />, { route: '/login', path: '/login', auth: makeAuth({ status: 'signedOut', user: null }) });
    const password = screen.getByLabelText('Password');
    await userEvent.type(password, 'secret#123');
    expect(password).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('secret#123');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
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
    await userEvent.type(screen.getByLabelText('Full name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Email'), 'rep@acme.com.gh');
    await userEvent.type(screen.getByLabelText('Password'), 'secret#123');
    await userEvent.type(screen.getByLabelText('Company contact phone'), '+233 24 123 4567');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(auth.register).toHaveBeenCalledWith({ fullName: 'Grace Hopper', role: 'company_rep', email: 'rep@acme.com.gh', password: 'secret#123', phone: '+233241234567' }),
    );
    expect(await screen.findAllByText('An account with this email already exists')).not.toHaveLength(0);
  });
});

describe('VerifyPage (US-01)', () => {
  const pending = () =>
    makeAuth({ user: { id: 7, email: 'ada@example.com', role: 'student', status: 'pending', phoneE164: '+233241234567', emailVerifiedAt: null } });

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

describe('forgot password (US-01)', () => {
  it('asks for a link and confirms without revealing whether the account exists', async () => {
    api.post.mockResolvedValue({ data: {} });
    renderApp(<ForgotPasswordPage />, { route: '/forgot-password', path: '/forgot-password', auth: makeAuth({ status: 'signedOut', user: null }) });

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(api.post).toHaveBeenCalledWith('/auth/password/forgot', { email: 'ada@example.com' });
    expect(await screen.findByText(/If an account uses ada@example.com/)).toBeInTheDocument();
  });

  it('sets the new password from the emailed link, then sends the user to sign in', async () => {
    api.post.mockResolvedValue({ data: {} });
    renderApp(<ResetPasswordPage />, { route: '/reset-password/abc', path: '/reset-password/:token', auth: makeAuth({ status: 'signedOut', user: null }) });

    await userEvent.type(screen.getByLabelText('New password'), 'n3w#password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'n3w#passw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'n3w#password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(api.post).toHaveBeenCalledWith('/auth/password/reset', { token: 'abc', password: 'n3w#password' });
    expect(await screen.findByTestId('location')).toHaveTextContent('/login?passwordReset=1');
  });

  it('offers a new link when the emailed one has expired', async () => {
    api.post.mockRejectedValue(apiFailure(410, 'RESET_LINK_EXPIRED', 'This reset link has expired. Request a new one.'));
    renderApp(<ResetPasswordPage />, { route: '/reset-password/abc', path: '/reset-password/:token', auth: makeAuth({ status: 'signedOut', user: null }) });

    await userEvent.type(screen.getByLabelText('New password'), 'n3w#password');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'n3w#password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText('This reset link has expired. Request a new one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });
});
