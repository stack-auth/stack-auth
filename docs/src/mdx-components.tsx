import * as CodeBlock from 'fumadocs-ui/components/codeblock';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

// OpenAPI sources
import { APIPage } from 'fumadocs-openapi/ui';
import { EnhancedAPIPage } from './components/api/enhanced-api-page';
import { WebhooksAPIPage } from './components/api/webhooks-api-page';

import AppleSecretGenerator from './components/apple-secret-generator';
import { Card, CardGroup, Info } from './components/mdx';
import ApiSequenceDiagram from './components/mdx/api-sequence-diagram';
import { AuthCard } from './components/mdx/auth-card';
import { DynamicCodeblock } from './components/mdx/dynamic-code-block';

import { AsideSection, CollapsibleMethodSection, CollapsibleTypesSection, MethodAside, MethodContent, MethodLayout, MethodSection, MethodTitle } from './components/ui/method-layout';

import { SDKOverview } from './components/sdk/overview';

import { Mermaid } from './components/mdx/mermaid';
import { Accordion, AccordionGroup, ClickableTableOfContents, CodeBlocks, Icon, Markdown, ParamField } from './components/mdx/sdk-components';
import { PropTable } from './components/prop-table';

import { SignInDemo, SignInExtraInfo, SignInPasswordFirstTab, SignInStackAuth } from './components/stack-auth/sign-in';
import { AccountSettingsStackAuth } from './components/stack-auth/stack-account-settings';
import { TeamSwitcherDemo } from './components/stack-auth/stack-team-switcher';
import { StackUserButton } from './components/stack-auth/stack-user-button';
import { UserButtonDemo } from './components/stack-auth/stack-user-button-demo';
import { Step, Steps } from './components/steps';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
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
    EnhancedAPIPage,
    WebhooksAPIPage,
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
    MethodLayout,
    MethodContent,
    MethodAside,
    MethodTitle,
    AsideSection,
    MethodSection,
    ClickableTableOfContents,
    CollapsibleMethodSection,
    CollapsibleTypesSection,
    SDKOverview,
    AppleSecretGenerator
  } as MDXComponents;
}
