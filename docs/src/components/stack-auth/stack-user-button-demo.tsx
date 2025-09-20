'use client';

import { UserButton, useUser } from '@stackframe/stack';
import { Wrench } from "lucide-react";
import { useState } from "react";
import { DynamicCodeblock } from "../mdx/dynamic-code-block";

type UserButtonDemoProps = {
  showUserInfo: boolean,
  colorModeToggle: boolean,
  extraItems: boolean,
}

export function UserButtonDemo() {
  const [props, setProps] = useState<UserButtonDemoProps>({
    showUserInfo: true,
    colorModeToggle: false,
    extraItems: false,
  });

  // Get the actual logged-in user
  const user = useUser();

  // Mock user data (used when no user is logged in)
  const mockUser = {
    displayName: "John Doe",
    primaryEmail: "john.doe@example.com",
    profileImageUrl: undefined,
  };

  // Generate the code example based on current props
  const generateCodeExample = () => {
    const extraItemsCode = `[{
        text: 'Custom Action',
        icon: <CustomIcon />,
        onClick: () => console.log('Custom action clicked')
      }]`;

    const propsArray = [`showUserInfo={${props.showUserInfo}}`];

    if (props.colorModeToggle) {
      propsArray.push(`colorModeToggle={() => console.log("color mode toggle clicked")}`);
    }

    if (props.extraItems) {
      propsArray.push(`extraItems={${extraItemsCode}}`);
    }

    const propsCode = propsArray.join('\n      ');

    return `import { UserButton } from "@stackframe/stack";

export function MyComponent() {
  return (
    <UserButton
      ${propsCode}
    />
  );
}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      {/* Main demo area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Controls Panel */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Component Options</h3>

          {/* Show User Info Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.showUserInfo}
                onChange={(e) => setProps(prev => ({ ...prev, showUserInfo: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">showUserInfo</span>
            </label>
            <p className="text-xs text-gray-600">Whether to display user information (display name and email) or only show the avatar.</p>
          </div>

          {/* Color Mode Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.colorModeToggle}
                onChange={(e) => setProps(prev => ({ ...prev, colorModeToggle: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">colorModeToggle</span>
            </label>
            <p className="text-xs text-gray-600">Function to be called when the color mode toggle button is clicked. If specified, a color mode toggle button will be shown.</p>
          </div>

          {/* Extra Items Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.extraItems}
                onChange={(e) => setProps(prev => ({ ...prev, extraItems: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">extraItems</span>
            </label>
            <p className="text-xs text-gray-600">Additional menu items to display in the dropdown.</p>
          </div>
        </div>

        {/* Component Preview */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Live Preview</h3>
          <div className="space-y-3">
            <div className="text-xs text-fd-muted-foreground">
              {user ? (
                <span className="text-green-600">✓ Using your actual account</span>
              ) : (
                <span className="text-blue-600">→ Using mock data (sign in to see your account)</span>
              )}
            </div>
            <div className="relative overflow-hidden rounded-lg border border-dashed border-blue-500/40 dark:border-blue-400/20 bg-gray-200/90 dark:bg-slate-900/30 shadow-sm p-4">
              {/* Component demo label */}
              <div className="absolute top-0 right-0 px-2 py-1 text-xs font-medium rounded-bl-md bg-gray-200/90 dark:bg-slate-800/80 border-l border-b border-gray-400/60 dark:border-gray-600/40">
                <span className="text-blue-600/80 dark:text-blue-400/70">Component Demo</span>
              </div>

              <div className="stack-scope">
                <UserButton
                  showUserInfo={props.showUserInfo}
                  mockUser={user ? undefined : mockUser}
                  colorModeToggle={props.colorModeToggle ? () => console.log("color mode toggle clicked") : undefined}
                  extraItems={props.extraItems ? [{
                    text: 'Custom Action',
                    icon: <Wrench />,
                    onClick: () => console.log('Custom action clicked')
                  }] : undefined}
                />
              </div>
            </div>
          </div>
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
