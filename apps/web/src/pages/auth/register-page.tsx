import { Eye, EyeOff, Mail, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { authErrorMessage, useAuth } from '@/features/auth/auth-context';
import { safeRedirect } from '@/features/auth/protected-route';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/error-state';

export function RegisterPage() {
  const { status, register } = useAuth();
  const [searchParams] = useSearchParams();
  const redirect = safeRedirect(searchParams.get('redirect'));

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  if (status === 'authenticated') {
    return <Navigate to={redirect} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    const minPasswordLength = 12;
    if (password.length < minPasswordLength) {
      setFieldError(`Use at least ${minPasswordLength} characters for your password.`);
      return;
    }
    if (password.length > 128) {
      setFieldError('Password must be 128 characters or fewer.');
      return;
    }
    if (password !== confirmPassword) {
      setFieldError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register({ displayName: displayName.trim(), email: email.trim(), password });
      setRegisteredEmail(email.trim());
    } catch (registerError) {
      setError(authErrorMessage(registerError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-forest">Create your account</h1>
        <p className="mt-1 text-sm text-muted">
          Start with a garden, add a plant, and record your first reading.
        </p>
      </div>

      {registeredEmail ? (
        <div className="rounded-card border border-success/20 bg-success-surface/60 p-5" role="status">
          <div className="flex items-center gap-2 text-forest">
            <Mail className="h-5 w-5 text-sage" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">Check your email</h2>
          </div>
          <p className="mt-2 text-sm text-muted">
            A confirmation link has been sent to <span className="font-medium text-ink">{registeredEmail}</span>.
            Please verify your email address to activate your account.
          </p>
          <div className="mt-5">
            <Link to="/login">
              <Button variant="primary">Proceed to Sign In</Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {error ? (
            <div className="mb-5">
              <ErrorState title="Registration failed" message={error} />
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <TextField
              label="Display name"
              name="displayName"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="How should we address you?"
              hint="Shown in your dashboard. You can change it later."
              optional
            />
            <TextField
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />

            <div className="relative">
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-11"
                placeholder="At least 12 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute top-[30px] right-1 flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-soft-sage hover:text-forest"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <TextField
              label="Confirm password"
              type={showPassword ? 'text' : 'password'}
              name="confirmPassword"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={fieldError}
              placeholder="Repeat your password"
            />

            <p className="text-xs text-muted">
              Your private gardens and records are isolated from other accounts. Simulated data will
              always be labeled.
            </p>

            <Button
              type="submit"
              className="w-full"
              loading={submitting}
              disabled={!email.trim() || !password || !confirmPassword}
              icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
            >
              Create account
            </Button>
          </form>

          <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link
              to={`/login?redirect=${encodeURIComponent(redirect)}`}
              className="font-semibold text-sage hover:text-forest"
            >
              Sign in
            </Link>
          </p>
        </>
      )}
    </Card>
  );
}
