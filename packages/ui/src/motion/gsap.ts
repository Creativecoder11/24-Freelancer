'use client';
/**
 * Single GSAP entry point. Plugins are registered once here; import gsap from '@24f/ui'
 * (or this module) everywhere else so registration is guaranteed.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

let registered = false;
export function registerGsap() {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger, useGSAP);
  gsap.defaults({ ease: 'power3.out' });
  registered = true;
}
registerGsap();

/** Media conditions used with gsap.matchMedia(). */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)';
export const MOTION_REDUCE = '(prefers-reduced-motion: reduce)';
export const MOTION_CONDITIONS = { ok: MOTION_OK, reduce: MOTION_REDUCE } as const;

/** Durations in seconds, mirroring --fl-duration-* (Doc 02 §4.9). */
export const DURATION = { fast: 0.12, base: 0.2, slow: 0.28 } as const;
/** --fl-ease-out cubic-bezier(0.2,0,0,1) ≈ expo-ish out; --fl-ease-in ≈ power2.in. */
export const EASE = { out: 'power3.out', in: 'power2.in' } as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOTION_REDUCE).matches;
}

export { gsap, ScrollTrigger, useGSAP };
