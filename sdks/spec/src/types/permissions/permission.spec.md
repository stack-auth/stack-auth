# TeamPermission

A permission granted to a user within a team.


## Properties

id: string
  The permission identifier (e.g., "read", "write", "admin").


---

# AdminTeamPermission

Admin view of a team permission. Same as TeamPermission.

Extends: TeamPermission


---

# AdminTeamPermissionDefinition

Definition of a team permission that can be granted.


## Properties

id: string
  Unique permission identifier.

description: string?
  Human-readable description of what this permission allows.

containedPermissionIds: string[]
  List of other permission IDs that are implied by this permission.
  For hierarchical permissions (e.g., "admin" contains "write" and "read").

isDefaultUserPermission: bool?
  Whether this permission is granted by default to new team members.


---

# ProjectPermission

A project-level permission granted to a user.


## Properties

id: string
  The permission identifier.


---

# AdminProjectPermission

Admin view of a project permission. Same as ProjectPermission.

Extends: ProjectPermission


---

# AdminProjectPermissionDefinition

Definition of a project-level permission.


## Properties

id: string
  Unique permission identifier.

description: string?
  Human-readable description.

containedPermissionIds: string[]
  List of implied permission IDs.


---

# Permission Definition CRUD (Admin only)


## Team Permission Definitions

### Create

createTeamPermissionDefinition(options)

options.id: string
options.description: string?
options.containedPermissionIds: string[]
options.isDefaultUserPermission: bool?

POST /team-permission-definitions { id, description, contained_permission_ids } [admin-only]
Route: apps/backend/src/app/api/latest/team-permission-definitions/route.ts


### Update

updateTeamPermissionDefinition(permissionId, options)

permissionId: string
options.description: string?
options.containedPermissionIds: string[]?

PATCH /team-permission-definitions/{permissionId} { description, contained_permission_ids } [admin-only]


### Delete

deleteTeamPermissionDefinition(permissionId)

permissionId: string

DELETE /team-permission-definitions/{permissionId} [admin-only]


### List

listTeamPermissionDefinitions()

Returns: AdminTeamPermissionDefinition[]

GET /team-permission-definitions [admin-only]


## Project Permission Definitions

### Create

createProjectPermissionDefinition(options)

options.id: string
options.description: string?
options.containedPermissionIds: string[]

POST /project-permission-definitions { id, description, contained_permission_ids } [admin-only]


### Update

updateProjectPermissionDefinition(permissionId, options)

permissionId: string
options.description: string?
options.containedPermissionIds: string[]?

PATCH /project-permission-definitions/{permissionId} { description, contained_permission_ids } [admin-only]


### Delete

deleteProjectPermissionDefinition(permissionId)

permissionId: string

DELETE /project-permission-definitions/{permissionId} [admin-only]


### List

listProjectPermissionDefinitions()

Returns: AdminProjectPermissionDefinition[]

GET /project-permission-definitions [admin-only]
