import { CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { firstPartyAuthClient } from '@/features/auth/first-party-client';
import { authErrorMessage } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';

export type VerificationState = 'idle' | 'verifying' | 'success' | 'error';

export function VerifyEmailPage() {
  const initialToken =
    typeof window !== 'undefined'
      ? firstPartyAuthClient.extractTokenFromFragment(window.location.hash, false)
      : null;

  const [state, setState] = useState<VerificationState>(() => (initialToken ? 'verifying' : 'error'));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    initialToken ? null : 'Missing verification token. Please use the link sent to your email.',
  );

  useEffect(() => {
    // Scrub token from hash fragment in browser history for privacy
    if (typeof window !== 'undefined' && window.location.hash.includes('token=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    if (!initialToken) {
      return;
    }

    let isMounted = true;

    async function submitVerification() {
      try {
        await firstPartyAuthClient.verifyEmail(initialToken!);
        if (isMounted) {
          setState('success');
        }
      } catch (err: unknown) {
        if (isMounted) {
          setState('error');
          setErrorMessage(
            authErrorMessage(err) || 'The verification link is invalid, expired, or has already been used.',
          );
        }
      }
    }

    void submitVerification();

    return () => {
      isMounted = false;
    };
  }, [initialToken]);

  return (
    <Card className="p-6 sm:p-8">
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 rounded-control text-sm font-medium text-muted hover:text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to sign in
      </Link>

      <div className="mt-5 mb-6">
        <h1 className="text-2xl font-semibold text-forest">Email verification</h1>
      </div>

      {state === 'verifying' && (
        <div className="flex flex-col items-center justify-center py-8 text-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-sage mb-3" aria-hidden="true" />
          <p className="text-base font-medium text-ink">Verifying your email address…</p>
          <p className="mt-1 text-sm text-muted">Please wait while we confirm your account.</p>
        </div>
      )}

      {state === 'success' && (
        <div className="rounded-card border border-success/20 bg-success-surface/60 p-5 text-center" role="status">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success mb-2" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">Email verified successfully!</h2>
          <p className="mt-1 text-sm text-muted">
            Your email address has been confirmed. You can now sign in to access your garden.
          </p>
          <div className="mt-6">
            <Link to="/login">
              <Button variant="primary" className="w-full">
                Proceed to Sign In
              </Button>
            </Link>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-5">
          <ErrorState
            title="Verification failed"
            message={errorMessage ?? 'The verification link is invalid, expired, or has already been used.'}
          />
          <div className="flex flex-col gap-2 pt-2">
            <Link to="/login">
              <Button variant="secondary" className="w-full">
                Return to Sign In
              </Button>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
