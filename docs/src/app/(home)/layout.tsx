import Footer from '@/components/homepage/homepage-footer';
import { HomeLayout } from '@/components/layouts/home-layout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <HomeLayout>
      {children}
      <Footer />
    </HomeLayout>
  );
}
