import { Bricolage_Grotesque, Caveat, Inter } from 'next/font/google';

export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter', display: 'swap' });

export const caveat = Caveat({ subsets: ['latin'], weight: ['700'], variable: '--font-caveat', display: 'swap' });
