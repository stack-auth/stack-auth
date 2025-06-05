import * as CodeBlock from 'fumadocs-ui/components/codeblock';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

// OpenAPI sources
import { APIPage } from 'fumadocs-openapi/ui';

// Raw @stackframe/stack components
//import { SignIn } from '@stackframe/stack';

// Custom components from @stackframe/stack
import { Card, CardGroup, Info } from './components/mdx';
import ApiSequenceDiagram from './components/mdx/api-sequence-diagram';
import { AuthCard } from './components/mdx/AuthCard';
import { DynamicCodeblock } from './components/mdx/DynamicCodeblock';
import { Accordion, AccordionGroup, CodeBlocks, Icon, Markdown, ParamField } from './components/mdx/SDKComponents';
import { PropTable } from './components/PropTable';


import { AccountSettingsStackAuth } from './components/stack-auth/account-settings';
import { SignInDemo, SignInExtraInfo, SignInPasswordFirstTab, SignInStackAuth } from './components/stack-auth/sign-in';
import { StackUserButton } from './components/stack-auth/stack-user-button';
import { TeamSwitcherDemo } from './components/stack-auth/team-switcher';
import { UserButtonDemo } from './components/stack-auth/user-button-demo';

import { Mermaid } from './components/mdx/mermaid';
import { Step, Steps } from './components/steps';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    ...CodeBlock,
    //SignIn
    Card,
    CardGroup,
    Info,
    SignInStackAuth,
    SignInPasswordFirstTab,
    SignInDemo,
    AuthCard,
    AccountSettingsStackAuth,
    SignInExtraInfo,
    StackUserButton,
    UserButtonDemo,
    TeamSwitcherDemo,
    Steps,
    Step,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    APIPage,
    TypeTable,
    PropTable,
    ApiSequenceDiagram,
    // SDK Documentation Components
    Markdown,
    ParamField,
    Accordion,
    AccordionGroup,
    CodeBlocks,
    Icon,
    DynamicCodeblock,
    Mermaid,
  } as MDXComponents;
}
