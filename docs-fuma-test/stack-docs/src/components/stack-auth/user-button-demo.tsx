'use client';

import { UserButton } from "@stackframe/stack";
import { Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { StackContainer } from "../mdx";

interface UserButtonDemoProps {
  showUserInfo: boolean;
  colorModeToggle: boolean;
  extraItems: boolean;
}

export function UserButtonDemo() {
  const [props, setProps] = useState<UserButtonDemoProps>({
    showUserInfo: true,
    colorModeToggle: false,
    extraItems: false,
  });

  const [highlightedCode, setHighlightedCode] = useState<string>("");

  // Mock user data
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

  // Update syntax highlighted code when props change
  useEffect(() => {
    const updateHighlightedCode = async () => {
      try {
        const html = await codeToHtml(generateCodeExample(), {
          lang: 'tsx',
          theme: 'github-dark',
          transformers: [{
            pre(node) {
              // Remove background styles from pre element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            },
            code(node) {
              // Remove background styles from code element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${generateCodeExample()}</code></pre>`);
      }
    };

    updateHighlightedCode();
  }, [props]);

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-6">
      {/* Main demo area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controls Panel */}
        <div className="space-y-6">
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
          <StackContainer color="blue" size="medium">
            <UserButton 
              showUserInfo={props.showUserInfo}
              mockUser={mockUser}
              colorModeToggle={props.colorModeToggle ? () => console.log("color mode toggle clicked") : undefined}
              extraItems={props.extraItems ? [{
                text: 'Custom Action',
                icon: <Wrench />,
                onClick: () => console.log('Custom action clicked')
              }] : undefined}
            />
          </StackContainer>
        </div>
      </div>

      {/* Code Example */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Code Example</h3>
        <div className="relative">
          <div 
            className="rounded-lg border bg-[#0a0a0a] p-4 overflow-auto max-h-[500px] text-sm"
            style={{ 
              background: '#0a0a0a !important',
            }}
          >
            <div 
              className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </div>
        </div>
      </div>
    </div>
  );
} 
