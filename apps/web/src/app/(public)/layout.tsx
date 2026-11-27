import { Footer } from '@24f/ui';
import { PublicNavbar } from '@/components/public/PublicNavbar';
import { SiteJsonLd } from '@/components/seo/JsonLd';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteJsonLd />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[999] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">
        Skip to content
      </a>
      <PublicNavbar />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
