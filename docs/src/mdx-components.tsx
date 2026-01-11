import * as CodeBlock from 'fumadocs-ui/components/codeblock';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { ComponentProps } from 'react';

// OpenAPI sources
import { APIPage } from 'fumadocs-openapi/ui';
import { EnhancedAPIPage } from './components/api/enhanced-api-page';
import { WebhooksAPIPage } from './components/api/webhooks-api-page';

import AppleSecretGenerator from './components/apple-secret-generator';
import { Card, CardGroup, Info, QuickLink, QuickLinks } from './components/mdx';
import ApiSequenceDiagram from './components/mdx/api-sequence-diagram';
import { AuthCard } from './components/mdx/auth-card';
import { DynamicCodeblock } from './components/mdx/dynamic-code-block';
import { EmbeddedLink } from './components/mdx/embedded-link';
import { PlatformCodeblock } from './components/mdx/platform-codeblock';

import { AsideSection, CollapsibleMethodSection, CollapsibleTypesSection, MethodAside, MethodContent, MethodLayout, MethodSection, MethodTitle } from './components/ui/method-layout';

import { HookDocumentation, HookFromJson } from './components/sdk/hook-documentation';
import { ObjectDocumentation, ObjectFromJson } from './components/sdk/object-documentation';
import { SDKOverview } from './components/sdk/overview';
import { TypeDocumentation, TypeFromJson } from './components/sdk/type-documentation';

import { CursorIcon, StackAuthIcon } from './components/icons';
import { Button } from './components/mdx/button';
import { JWTViewer } from './components/mdx/jwt-viewer';
import { Mermaid } from './components/mdx/mermaid';
import { Accordion, AccordionGroup, ClickableTableOfContents, Icon, Markdown, ParamField } from './components/mdx/sdk-components';
import { PropTable } from './components/prop-table';

import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import DocsSelector from './components/homepage/iconHover';
import { AppCard, AppGrid } from './components/mdx/app-card';
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
    QuickLink,
    QuickLinks,
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
    Icon,
    DynamicCodeblock,
    PlatformCodeblock,
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
    TypeDocumentation,
    TypeFromJson,
    HookDocumentation,
    HookFromJson,
    ObjectDocumentation,
    ObjectFromJson,
    AppleSecretGenerator,
    // Logo Icons
    StackAuthIcon,
    CursorIcon,
    // UI Components
    Button,
    JWTViewer,
    // App Components
    AppCard,
    AppGrid,
    DocsSelector,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img: (props) => <ImageZoom {...(props as any)} />,
  } as MDXComponents;
}

// MDX components for embedded mode - includes link rewriting
export function getEmbeddedMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...getMDXComponents(components),
    // Override the link component to use embedded URLs
    a: (props: ComponentProps<'a'>) => <EmbeddedLink {...props} isEmbedded={true} />,
  } as MDXComponents;
}
