/** One source of truth for the public site identity (metadata, sitemap, robots, JSON-LD, llms.txt). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://24freelancing.com').replace(/\/$/, '');
export const SITE_NAME = '24 Freelancing';
export const SITE_TAGLINE = 'Earn from small online tasks, or get work done by many people at once';
export const SITE_DESCRIPTION =
  '24 Freelancing is a microtask marketplace. Workers earn by completing small online tasks — surveys, data entry, app and website testing, writing and more — with the reward, time and proof shown up front. Employers post a job once and get it done by many people, paying only for approved work.';

export const abs = (path = '/') => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
