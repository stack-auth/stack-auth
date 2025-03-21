'use client';

import dynamic from "next/dynamic";

const PageView = dynamic(() => import('./pageview-dynamic'), {
  ssr: false,
});

export default PageView;
