import { FeaturePlaceholder } from '@/components/feature-placeholder';

export { MonitoringNewPage } from './monitoring/monitoring-new-page';
export { AnalyticsPage } from './analytics/analytics-page';

export function TasksPage() {
  return (
    <FeaturePlaceholder
      title="Care Tasks"
      description="Plan and record watering, inspection, fertilizing, and harvest work."
      phase="Phase 8"
      planned={[
        'Today, upcoming, and completed filters',
        'Create and edit task forms',
        'Complete and reopen actions with timestamps',
        'Priority and due date support',
        'Garden and plant references limited to owned records',
      ]}
    />
  );
}

export function TaskNewPage() {
  return (
    <FeaturePlaceholder
      title="Create Task"
      description="Define a care task, when it is due, and which owned garden or plant it belongs to."
      phase="Phase 8"
      planned={[
        'Title and task type',
        'Due date and priority',
        'Garden and optional plant selector',
        'Optional description',
        'Persisted completion history',
      ]}
      backTo={{ to: '/dashboard/tasks', label: 'Back to tasks' }}
    />
  );
}

export function TaskDetailPage() {
  return (
    <FeaturePlaceholder
      title="Task detail"
      description="Review, edit, complete, or reopen one care task."
      phase="Phase 8"
      planned={[
        'Task metadata and related plant',
        'Edit form with validation',
        'Complete action with completion timestamp',
        'Reopen behavior where supported',
        'Delete confirmation',
      ]}
      backTo={{ to: '/dashboard/tasks', label: 'Back to tasks' }}
    />
  );
}
