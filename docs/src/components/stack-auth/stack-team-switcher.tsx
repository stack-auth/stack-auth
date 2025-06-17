'use client';

import { SelectedTeamSwitcher } from '@stackframe/stack';
import { useState } from 'react';
import { StackContainer } from '../mdx';
import { DynamicCodeblock } from '../mdx/dynamic-code-block';

// Mock data for demo purposes
const mockUser = {
  selectedTeam: {
    id: "team-1",
    displayName: "Development Team",
    profileImageUrl: null,
  },
};

const mockTeams = [
  {
    id: "team-1",
    displayName: "Development Team",
    profileImageUrl: null,
  },
  {
    id: "team-2",
    displayName: "Marketing Team",
    profileImageUrl: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=100&h=100&fit=crop&crop=face",
  },
  {
    id: "team-3",
    displayName: "Design Team",
    profileImageUrl: null,
  },
  {
    id: "team-4",
    displayName: "Product Management",
    profileImageUrl: null,
  },
];

const mockProject = {
  config: {
    clientTeamCreationEnabled: true,
  },
};

type TeamSwitcherDemoProps = {
  noUpdateSelectedTeam: boolean,
  urlMap: boolean,
  teamScenario: 'normal' | 'no-teams' | 'many-teams' | 'no-creation',
}

export function TeamSwitcherDemo() {
  const [props, setProps] = useState<TeamSwitcherDemoProps>({
    noUpdateSelectedTeam: false,
    urlMap: false,
    teamScenario: 'normal',
  });

  // Generate mock data based on current scenario
  const getMockData = () => {
    switch (props.teamScenario) {
      case 'no-teams': {
        return {
          mockUser: { selectedTeam: undefined },
          mockTeams: [],
          mockProject,
        };
      }
      case 'many-teams': {
        return {
          mockUser,
          mockTeams: [
            ...mockTeams,
            {
              id: "team-5",
              displayName: "Engineering - Backend",
              profileImageUrl: null,
            },
            {
              id: "team-6",
              displayName: "Engineering - Frontend",
              profileImageUrl: null,
            },
            {
              id: "team-7",
              displayName: "Customer Success",
              profileImageUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&h=100&fit=crop&crop=face",
            },
          ],
          mockProject,
        };
      }
      case 'no-creation': {
        return {
          mockUser,
          mockTeams,
          mockProject: {
            config: {
              clientTeamCreationEnabled: false,
            },
          },
        };
      }
      default: {
        return {
          mockUser,
          mockTeams,
          mockProject,
        };
      }
    }
  };

  const { mockUser: currentMockUser, mockTeams: currentMockTeams, mockProject: currentMockProject } = getMockData();

  // Generate the code example based on current props
  const generateCodeExample = () => {
    const propsArray: string[] = [];

    if (props.noUpdateSelectedTeam) {
      propsArray.push('noUpdateSelectedTeam={true}');
    }

    if (props.urlMap) {
      propsArray.push('urlMap={(team: { id: string }) => `/teams/${team.id}/dashboard`}');
    }

    const propsCode = propsArray.length > 0 ? '\n      ' + propsArray.join('\n      ') + '\n    ' : '';

    return `import { SelectedTeamSwitcher } from "@stackframe/stack";

export function MyTeamSwitcher() {
  return (
    <SelectedTeamSwitcher${propsCode}/>
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

          {/* No Update Selected Team Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.noUpdateSelectedTeam}
                onChange={(e) => setProps(prev => ({ ...prev, noUpdateSelectedTeam: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">noUpdateSelectedTeam</span>
            </label>
            <p className="text-xs text-gray-600">If true, prevents the component from updating the user&apos;s selected team when a team is chosen.</p>
          </div>

          {/* URL Map Toggle */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={props.urlMap}
                onChange={(e) => setProps(prev => ({ ...prev, urlMap: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">urlMap</span>
            </label>
            <p className="text-xs text-gray-600">Function that maps a team to a URL. When provided, selecting a team will navigate to the mapped URL.</p>
          </div>

          {/* Team Scenario Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Team Scenario</label>
            <div className="space-y-1">
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="teamScenario"
                  value="normal"
                  checked={props.teamScenario === 'normal'}
                  onChange={(e) => setProps(prev => ({ ...prev, teamScenario: e.target.value as 'normal' }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Normal (4 teams)</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="teamScenario"
                  value="no-teams"
                  checked={props.teamScenario === 'no-teams'}
                  onChange={(e) => setProps(prev => ({ ...prev, teamScenario: e.target.value as 'no-teams' }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">No teams available</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="teamScenario"
                  value="many-teams"
                  checked={props.teamScenario === 'many-teams'}
                  onChange={(e) => setProps(prev => ({ ...prev, teamScenario: e.target.value as 'many-teams' }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Many teams (7 teams)</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="teamScenario"
                  value="no-creation"
                  checked={props.teamScenario === 'no-creation'}
                  onChange={(e) => setProps(prev => ({ ...prev, teamScenario: e.target.value as 'no-creation' }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Team creation disabled</span>
              </label>
            </div>
            <p className="text-xs text-gray-600">Different scenarios to demonstrate various states of the team switcher.</p>
          </div>
        </div>

        {/* Component Preview */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Live Preview</h3>
          <StackContainer color="green" size="medium">
            <div className="flex items-center justify-center p-4">
              <SelectedTeamSwitcher
                noUpdateSelectedTeam={props.noUpdateSelectedTeam}
                urlMap={props.urlMap ? (team: { id: string }) => `/teams/${team.id}/dashboard` : undefined}
                mockUser={currentMockUser}
                mockTeams={currentMockTeams}
                mockProject={currentMockProject}
              />
            </div>
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

// Simple components for backward compatibility and basic usage
export function TeamSwitcherStackAuth() {
  return (
    <StackContainer color="green" size="medium">
      <div className="flex items-center justify-center p-4">
        <SelectedTeamSwitcher
          mockUser={mockUser}
          mockTeams={mockTeams}
          mockProject={mockProject}
        />
      </div>
    </StackContainer>
  );
}

export function TeamSwitcherNoTeams() {
  return (
    <StackContainer color="amber" size="medium">
      <div className="flex items-center justify-center p-4">
        <SelectedTeamSwitcher
          mockUser={{ selectedTeam: undefined }}
          mockTeams={[]}
          mockProject={mockProject}
        />
      </div>
    </StackContainer>
  );
}

export function TeamSwitcherNoCreation() {
  return (
    <StackContainer color="purple" size="medium">
      <div className="flex items-center justify-center p-4">
        <SelectedTeamSwitcher
          mockUser={mockUser}
          mockTeams={mockTeams}
          mockProject={{
            config: {
              clientTeamCreationEnabled: false,
            },
          }}
        />
      </div>
    </StackContainer>
  );
}

export function TeamSwitcherManyTeams() {
  const manyTeams = [
    ...mockTeams,
    {
      id: "team-5",
      displayName: "Engineering - Backend",
      profileImageUrl: null,
    },
    {
      id: "team-6",
      displayName: "Engineering - Frontend",
      profileImageUrl: null,
    },
    {
      id: "team-7",
      displayName: "Customer Success",
      profileImageUrl: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&h=100&fit=crop&crop=face",
    },
  ];

  return (
    <StackContainer color="blue" size="medium">
      <div className="flex items-center justify-center p-4">
        <SelectedTeamSwitcher
          mockUser={mockUser}
          mockTeams={manyTeams}
          mockProject={mockProject}
        />
      </div>
    </StackContainer>
  );
}
