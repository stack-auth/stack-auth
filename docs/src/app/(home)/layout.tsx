import { baseOptions } from '@/app/layout.config';
import Footer from '@/components/homepage/homepage-footer';
import { HomeLayout } from 'fumadocs-ui/layouts/home';

// Enable search for home page navbar
const homeOptions = {
  ...baseOptions,
  searchToggle: {
    enabled: true,
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <HomeLayout {...homeOptions}>
      {children}
      <Footer />
    </HomeLayout>
  );
}
