import type { DataGridColumnDef } from "@stackframe/dashboard-ui-components";

// ─── Sample data type ────────────────────────────────────────────────

export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  status: "active" | "inactive" | "pending";
  signUps: number;
  lastLogin: Date;
  verified: boolean;
  country: string;
  revenue: number;
};

// ─── Column definitions ──────────────────────────────────────────────

export const DEMO_COLUMNS: DataGridColumnDef<User>[] = [
  {
    id: "name",
    header: "Name",
    accessor: "name",
    width: 180,
    type: "string",
    renderCell: ({ value, row }) => (
      // Custom cell with avatar-like initial
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold flex-shrink-0">
          {String(value).charAt(0).toUpperCase()}
        </div>
        <span className="truncate font-medium">{String(value)}</span>
      </div>
    ),
  },
  {
    id: "email",
    header: "Email",
    accessor: "email",
    width: 220,
    type: "string",
    renderCell: ({ value }) => (
      <span className="text-muted-foreground truncate">{String(value)}</span>
    ),
  },
  {
    id: "role",
    header: "Role",
    accessor: "role",
    width: 120,
    type: "singleSelect",
    valueOptions: [
      { value: "admin", label: "Admin" },
      { value: "editor", label: "Editor" },
      { value: "viewer", label: "Viewer" },
    ],
    renderCell: ({ value }) => {
      const colors: Record<string, string> = {
        admin: "bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-purple-500/20",
        editor: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20",
        viewer: "bg-foreground/[0.04] text-muted-foreground ring-1 ring-foreground/[0.06]",
      };
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${colors[String(value)] ?? ""}`}>
          {String(value)}
        </span>
      );
    },
  },
  {
    id: "status",
    header: "Status",
    accessor: "status",
    width: 110,
    type: "singleSelect",
    valueOptions: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
      { value: "pending", label: "Pending" },
    ],
    renderCell: ({ value }) => {
      const dot: Record<string, string> = {
        active: "bg-emerald-500",
        inactive: "bg-foreground/20",
        pending: "bg-amber-500",
      };
      return (
        <div className="flex items-center gap-1.5">
          <div className={`h-1.5 w-1.5 rounded-full ${dot[String(value)] ?? ""}`} />
          <span className="text-xs capitalize">{String(value)}</span>
        </div>
      );
    },
  },
  {
    id: "signUps",
    header: "Sign-ups",
    accessor: "signUps",
    width: 110,
    type: "number",
    align: "right",
    renderCell: ({ value }) => (
      <span className="tabular-nums font-medium">{Number(value).toLocaleString()}</span>
    ),
  },
  {
    id: "revenue",
    header: "Revenue",
    accessor: "revenue",
    width: 120,
    type: "number",
    align: "right",
    renderCell: ({ value }) => (
      <span className="tabular-nums font-medium">
        ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    ),
    formatValue: (v) => `$${Number(v).toFixed(2)}`,
  },
  {
    id: "lastLogin",
    header: "Last login",
    accessor: "lastLogin",
    width: 150,
    type: "date",
    renderCell: ({ value }) => (
      <span className="text-muted-foreground tabular-nums text-xs">
        {value instanceof Date ? value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"}
      </span>
    ),
  },
  {
    id: "verified",
    header: "Verified",
    accessor: "verified",
    width: 90,
    type: "boolean",
    align: "center",
  },
  {
    id: "country",
    header: "Country",
    accessor: "country",
    width: 130,
    type: "string",
  },
];

// ─── Sample data ─────────────────────────────────────────────────────

const firstNames = [
  "Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Hank",
  "Ivy", "Jack", "Karen", "Leo", "Mia", "Noah", "Olivia", "Paul",
  "Quinn", "Rose", "Sam", "Tina", "Uma", "Vince", "Wendy", "Xander",
  "Yara", "Zack", "Aria", "Blake", "Clara", "Dean", "Ella", "Finn",
  "Gina", "Hugo", "Iris", "Jake", "Kira", "Liam", "Maya", "Nate",
  "Opal", "Petra", "Quinn", "Riley", "Sage", "Troy", "Ursa", "Vale",
  "Wren", "Zoe",
];
const lastNames = [
  "Anderson", "Brown", "Chen", "Davis", "Evans", "Fisher", "Garcia",
  "Harris", "Ivanov", "Jones", "Kim", "Lee", "Martinez", "Nguyen",
  "O'Brien", "Patel", "Quinn", "Robinson", "Smith", "Taylor", "Ueda",
  "Vasquez", "Wilson", "Xu", "Yang", "Zhang", "Moore", "Clark",
  "Lewis", "Walker",
];
const countries = [
  "United States", "United Kingdom", "Germany", "France", "Canada",
  "Japan", "Australia", "Brazil", "India", "South Korea", "Netherlands",
  "Sweden", "Norway", "Mexico", "Spain",
];
const roles: User["role"][] = ["admin", "editor", "viewer"];
const statuses: User["status"][] = ["active", "inactive", "pending"];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateUsers(count: number): User[] {
  const rng = seededRandom(42);
  const users: User[] = [];

  for (let i = 0; i < count; i++) {
    const firstName = firstNames[Math.floor(rng() * firstNames.length)]!;
    const lastName = lastNames[Math.floor(rng() * lastNames.length)]!;
    const domain = ["gmail.com", "company.io", "outlook.com", "hey.com"][Math.floor(rng() * 4)]!;

    users.push({
      id: `user-${i + 1}`,
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
      role: roles[Math.floor(rng() * roles.length)]!,
      status: statuses[Math.floor(rng() * (i < count * 0.7 ? 2 : 3))]!,
      signUps: Math.floor(rng() * 5000),
      lastLogin: new Date(Date.now() - Math.floor(rng() * 90 * 24 * 60 * 60 * 1000)),
      verified: rng() > 0.25,
      country: countries[Math.floor(rng() * countries.length)]!,
      revenue: Math.floor(rng() * 100000) / 100,
    });
  }

  return users;
}

// Pre-generate datasets
export const DEMO_USERS_200 = generateUsers(200);
export const DEMO_USERS_10K = generateUsers(10_000);
