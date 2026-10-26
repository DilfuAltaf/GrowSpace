import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonStyles } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function NotFoundPage() {
  return (
    <div className="container-page py-16">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you requested does not exist or may have moved."
        action={
          <Link to="/" className={buttonStyles('primary')}>
            Back to home
          </Link>
        }
        secondaryAction={
          <Link to="/plants" className={buttonStyles('secondary')}>
            Browse plants
          </Link>
        }
      />
    </div>
  );
}
