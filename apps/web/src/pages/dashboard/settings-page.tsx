import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

export function SettingsPage() {
  const { user, signOutUser } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOutUser();
    navigate('/');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Account and preferences"
        description="Profile editing and display preferences will be connected to the API in a later phase."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-sage" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-forest">Profile</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex flex-col gap-0.5 border-b border-line pb-3">
              <dt className="text-muted">Display name</dt>
              <dd className="font-medium text-ink">{user?.displayName || 'Not set'}</dd>
            </div>
            <div className="flex flex-col gap-0.5 border-b border-line pb-3">
              <dt className="text-muted">Email</dt>
              <dd className="font-medium break-all text-ink">{user?.email || 'Not available'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Email verification</dt>
              <dd>
                <Badge variant={user?.emailVerified ? 'success' : 'warning'}>
                  {user?.emailVerified ? 'Verified' : 'Not verified'}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-sage" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-forest">Display preferences</h2>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="temperature-unit" className="field-label">
                Temperature unit
              </label>
              <select id="temperature-unit" className="field-input" disabled defaultValue="celsius">
                <option value="celsius">Celsius (°C)</option>
                <option value="fahrenheit">Fahrenheit (°F)</option>
              </select>
              <p className="mt-1.5 text-sm text-muted">
                Temperature conversion helpers exist, but the preference is not saved yet.
              </p>
            </div>
            <p className="rounded-control bg-page/70 p-3 text-xs text-muted">
              Unimplemented settings are shown as disabled instead of pretending to work.
            </p>
          </div>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-forest">Session</h2>
        <p className="mt-1 text-sm text-muted">
          Signing out ends your session. Protected routes will no longer display private
          data.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={handleSignOut}
          icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
        >
          Sign out
        </Button>
      </Card>

      <Card className="border-line bg-page/50 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-forest">Account data</h2>
        <p className="mt-1 text-sm text-muted">
          Account deletion and data export are not implemented in this scaffold. The data model is
          designed so private records are owned by a single account and can be removed through a
          trusted server process.
        </p>
      </Card>
    </div>
  );
}
