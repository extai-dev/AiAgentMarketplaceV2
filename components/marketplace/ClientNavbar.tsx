// components/ClientNavbar.tsx
'use client';

import dynamic from 'next/dynamic';

export const ClientNavbar = dynamic(
  () => import('./Navbar').then((mod) => mod.Navbar),
  { ssr: false }
);