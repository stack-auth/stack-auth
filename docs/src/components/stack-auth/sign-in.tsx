'use client';

import { SignIn } from '@stackframe/stack';
import { useState } from 'react';
import { StackContainer } from '../mdx';
import { DynamicCodeblock } from '../mdx/dynamic-code-block';

// Mock project configuration for demo purposes
const mockProject = {
  config: {
    signUpEnabled: true,
    credentialEnabled: true,
    passkeyEnabled: true,
    magicLinkEnabled: true,
    oauthProviders: [
      { id: 'google' },
      { id: 'github' },
    ],
  },
};

type SignInDemoProps = {
  fullPage: boolean,
  automaticRedirect: boolean,
  firstTab: 'magic-link' | 'password',
  showExtraInfo: boolean,
}

export function SignInDemo() {
  const [props, setProps] = useState<SignInDemoProps>({
    fullPage: false,
    automaticRedirect: false,
    firstTab: 'magic-link',
    showExtraInfo: false,
  });

  // Generate the code example based on current props
  const generateCodeExample = () => {
    const propsArray: string[] = [];

    if (props.fullPage) {
      propsArray.push('fullPage={true}');
    }

    if (props.automaticRedirect) {
      propsArray.push('automaticRedirect={true}');
    }

    if (props.firstTab === 'password') {
      propsArray.push('firstTab="password"');
    }

    if (props.showExtraInfo) {
      propsArray.push('extraInfo={<>By signing in, you agree to our <a href="/terms">Terms</a></>}');
    }

    const propsCode = propsArray.length > 0 ? '\n      ' + propsArray.join('\n      ') + '\n    ' : '';

    return `import { SignIn } from "@stackframe/stack";

export function MySignInPage() {
  return (
    <SignIn${propsCode}/>
  );
}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      {/* Main demo area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controls Panel */}
        <div className="space-y-6">
          <h3 className="text-lg font-semibold">Component Options</h3>

          {/* Full Page Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.fullPage}
                onChange={(e) => setProps(prev => ({ ...prev, fullPage: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">fullPage</span>
            </label>
            <p className="text-xs text-gray-600">If true, renders the sign-in page in full-page mode with additional styling.</p>
          </div>

          {/* Automatic Redirect Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.automaticRedirect}
                onChange={(e) => setProps(prev => ({ ...prev, automaticRedirect: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">automaticRedirect</span>
            </label>
            <p className="text-xs text-gray-600">If true, automatically redirects when user is already signed in without showing the &apos;You are signed in&apos; message.</p>
          </div>

          {/* First Tab Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">firstTab</label>
            <div className="space-y-1">
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="firstTab"
                  value="magic-link"
                  checked={props.firstTab === 'magic-link'}
                  onChange={(e) => setProps(prev => ({ ...prev, firstTab: e.target.value as 'magic-link' }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">magic-link</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="firstTab"
                  value="password"
                  checked={props.firstTab === 'password'}
                  onChange={(e) => setProps(prev => ({ ...prev, firstTab: e.target.value as 'password' }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">password</span>
              </label>
            </div>
            <p className="text-xs text-gray-600">Determines which tab is initially active when both email and password authentication are enabled.</p>
          </div>

          {/* Extra Info Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.showExtraInfo}
                onChange={(e) => setProps(prev => ({ ...prev, showExtraInfo: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">extraInfo</span>
            </label>
            <p className="text-xs text-gray-600">Additional content to be displayed below the sign-in form, such as terms of service links.</p>
          </div>
        </div>

        {/* Component Preview */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Live Preview</h3>
          <StackContainer color="amber" size={props.fullPage ? "full" : "large"}>
            <SignIn
              fullPage={props.fullPage}
              automaticRedirect={props.automaticRedirect}
              firstTab={props.firstTab}
              extraInfo={props.showExtraInfo ? <>By signing in, you agree to our <a href="#" className="text-fd-primary hover:underline">Terms of Service</a></> : undefined}
              mockProject={mockProject}
            />
          </StackContainer>
        </div>
      </div>

      {/* Code Example */}
      <DynamicCodeblock
        code={generateCodeExample()}
        title="Code Example"
      />
    </div>
  );
}

// Keep the original simple components for backward compatibility
export function SignInStackAuth() {
  return (
    <StackContainer color="amber">
      <SignIn mockProject={mockProject} />
    </StackContainer>
  );
}

export function SignInPasswordFirstTab() {
  return (
    <StackContainer color="green">
      <SignIn
        firstTab="password"
        mockProject={mockProject}
      />
    </StackContainer>
  );
}

export function SignInExtraInfo() {
  return (
    <StackContainer color="blue">
      <SignIn
        extraInfo={<>By signing in, you agree to our <a href="#" className="text-fd-primary hover:underline">Terms of Service</a></>}
        mockProject={mockProject}
      />
    </StackContainer>
  );
}
