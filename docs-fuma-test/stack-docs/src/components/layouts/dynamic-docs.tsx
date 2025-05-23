'use client';
import { baseOptions } from '@/app/layout.config';
import type { ReactNode } from 'react';
import { useDynamicNavigation } from '../dynamic-navigation';
import { DocsLayout, type DocsLayoutProps } from './docs';

interface DynamicDocsLayoutProps extends Omit<DocsLayoutProps, 'links'> {
  children: ReactNode;
}

export function DynamicDocsLayout({ children, ...props }: DynamicDocsLayoutProps) {
  const dynamicLinks = useDynamicNavigation();

  return (
    <DocsLayout 
      {...baseOptions} 
      {...props}
      links={dynamicLinks}
    >
      {children}
    </DocsLayout>
  );
} 
