import { baseOptions } from '@/app/layout.config';
import Footer from '@/components/homepage/Footer';
import { HomeLayout } from 'fumadocs-ui/layouts/home';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <HomeLayout {...baseOptions}>
      {children}
      <Footer />
    </HomeLayout>
  );
}
