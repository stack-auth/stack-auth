import { Card, Typography } from '@stackframe/stack-ui';
import { useTranslations } from 'next-intl';

export const metadata = {
  title: "i18n Test",
};

export default function I18nTestPage() {
  const t = useTranslations('common');
  const tProjects = useTranslations('projects');
  const tAuth = useTranslations('auth');

  return (
    <div className="container mx-auto p-8 space-y-6">
      <Typography type="h1">i18n Test Page</Typography>

      <Card className="p-6">
        <Typography type="h2" className="mb-4">Common Translations</Typography>
        <ul className="space-y-2">
          <li>Dashboard: {t('dashboard')}</li>
          <li>Projects: {t('projects')}</li>
          <li>Settings: {t('settings')}</li>
          <li>Save: {t('save')}</li>
          <li>Cancel: {t('cancel')}</li>
          <li>Loading: {t('loading')}</li>
        </ul>
      </Card>

      <Card className="p-6">
        <Typography type="h2" className="mb-4">Projects Translations</Typography>
        <ul className="space-y-2">
          <li>Title: {tProjects('title')}</li>
          <li>New Project: {tProjects('newProject')}</li>
          <li>Create Project: {tProjects('createProject')}</li>
        </ul>
      </Card>

      <Card className="p-6">
        <Typography type="h2" className="mb-4">Auth Translations</Typography>
        <ul className="space-y-2">
          <li>Sign In: {tAuth('signIn')}</li>
          <li>Sign Up: {tAuth('signUp')}</li>
          <li>Email: {tAuth('email')}</li>
          <li>Password: {tAuth('password')}</li>
        </ul>
      </Card>

      <Card className="p-6 bg-blue-50 dark:bg-blue-950">
        <Typography type="h3" className="mb-2">How to Test</Typography>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Check the language switcher in the navbar (top right, globe icon 🌐)</li>
          <li>Click to switch between English and 中文</li>
          <li>Observe how the text on this page changes</li>
          <li>Try switching languages: /i18n-test (English) vs /zh/i18n-test (Chinese)</li>
        </ol>
      </Card>
    </div>
  );
}

