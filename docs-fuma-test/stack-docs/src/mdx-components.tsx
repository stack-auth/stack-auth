import * as CodeBlock from 'fumadocs-ui/components/codeblock';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

// OpenAPI sources
import { openapi } from '../lib/source';

// Raw @stackframe/stack components
import { SignIn } from '@stackframe/stack';

// Custom components from @stackframe/stack
import { SignInExtraInfo, SignInPasswordFirstTab, SignInStackAuth } from './components/stack-auth/sign-in';

// Custom components
import { Card, CardGroup, Info } from './components/mdx';
import { AuthCard } from './components/mdx/AuthCard';
import { Step, Steps } from './components/steps';
import { Tab, Tabs } from './components/tabs';

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    ...CodeBlock,
    SignIn,
    Card,
    CardGroup,
    Info,
    SignInStackAuth,
    SignInPasswordFirstTab,
    AuthCard,
    SignInExtraInfo,
    Steps,
    Step,
    Tabs,
    Tab,
    APIPage: openapi.APIPage,
  };
}
