import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '@/components/layout/public-layout';
import { AuthLayout } from '@/components/layout/auth-layout';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { ScrollToTop } from '@/components/scroll-to-top';
import { ProtectedRoute } from '@/features/auth/protected-route';
import { LandingPage } from '@/pages/public/landing-page';
import { AboutPage } from '@/pages/public/about-page';
import { PlantsPage } from '@/pages/public/plants-page';
import { PlantDetailPage } from '@/pages/public/plant-detail-page';
import { LoginPage } from '@/pages/auth/login-page';
import { RegisterPage } from '@/pages/auth/register-page';
import { ForgotPasswordPage } from '@/pages/auth/forgot-password-page';
import { VerifyEmailPage } from '@/pages/auth/verify-email-page';
import { ResetPasswordPage } from '@/pages/auth/reset-password-page';
import { DashboardPage } from '@/pages/dashboard/dashboard-page';
import { MonitoringPage } from '@/pages/dashboard/monitoring-page';
import { SettingsPage } from '@/pages/dashboard/settings-page';
import { GardensListPage } from '@/pages/dashboard/gardens/gardens-list-page';
import { GardenNewPage } from '@/pages/dashboard/gardens/garden-new-page';
import { GardenDetailPage } from '@/pages/dashboard/gardens/garden-detail-page';
import { GardenEditPage } from '@/pages/dashboard/gardens/garden-edit-page';
import { PlantsListPage } from '@/pages/dashboard/plants/plants-list-page';
import { PlantNewPage } from '@/pages/dashboard/plants/plant-new-page';
import { PlantDetailDashboardPage } from '@/pages/dashboard/plants/plant-detail-page';
import { PlantEditPage } from '@/pages/dashboard/plants/plant-edit-page';
import {
  AnalyticsPage,
  MonitoringNewPage,
} from '@/pages/dashboard/feature-pages';
import { TasksListPage } from '@/pages/dashboard/tasks/tasks-list-page';
import { CareCalendarPage } from '@/pages/dashboard/tasks/care-calendar-page';
import { TaskNewPage } from '@/pages/dashboard/tasks/task-new-page';
import { TaskDetailPage } from '@/pages/dashboard/tasks/task-detail-page';
import { FarmingAssistantPage } from '@/pages/dashboard/assistant/farming-assistant-page';
import { NotificationsPage } from '@/pages/dashboard/notifications/notifications-page';
import { NotFoundPage } from '@/pages/not-found-page';

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/plants" element={<PlantsPage />} />
          <Route path="/plants/:slug" element={<PlantDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="gardens" element={<GardensListPage />} />
            <Route path="gardens/new" element={<GardenNewPage />} />
            <Route path="gardens/:gardenId" element={<GardenDetailPage />} />
            <Route path="gardens/:gardenId/edit" element={<GardenEditPage />} />
            <Route path="plants" element={<PlantsListPage />} />
            <Route path="plants/new" element={<PlantNewPage />} />
            <Route path="plants/:plantId" element={<PlantDetailDashboardPage />} />
            <Route path="plants/:plantId/edit" element={<PlantEditPage />} />
            <Route path="assistant" element={<FarmingAssistantPage />} />
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="monitoring/new" element={<MonitoringNewPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="tasks" element={<TasksListPage />} />
            <Route path="calendar" element={<CareCalendarPage />} />
            <Route path="tasks/new" element={<TaskNewPage />} />
            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
