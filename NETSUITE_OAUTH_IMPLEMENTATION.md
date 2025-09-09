# NetSuite OAuth Provider Implementation

This document outlines the implementation of the NetSuite OAuth provider for Stack Auth.

## Overview

NetSuite OAuth 2.0 provider has been successfully implemented and integrated into the Stack Auth system. The implementation follows the existing patterns and supports the OAuth 2.0 Authorization Code Grant flow.

## Files Modified/Created

### New Files
- `apps/backend/src/oauth/providers/netsuite.tsx` - NetSuite OAuth provider implementation

### Modified Files
- `apps/backend/src/oauth/index.tsx` - Added NetSuite provider to registry
- `packages/stack-shared/src/utils/oauth.tsx` - Added 'netsuite' to standardProviders array
- `packages/stack-shared/src/schema-fields.ts` - Added oauthNetSuiteAccountIdSchema
- `packages/stack-shared/src/config/schema.ts` - Added netsuiteAccountId to config schema
- `packages/stack-shared/src/interface/crud/projects.ts` - Added netsuite_account_id to OAuth provider schema
- `apps/backend/src/lib/projects.tsx` - Added netsuiteAccountId mapping

## NetSuite OAuth Configuration

### Required Environment Variables
- `STACK_NETSUITE_CLIENT_ID` - NetSuite OAuth Client ID
- `STACK_NETSUITE_CLIENT_SECRET` - NetSuite OAuth Client Secret
- `STACK_NETSUITE_ACCOUNT_ID` - NetSuite Account ID (optional, can be provided in config)

### NetSuite Setup Requirements

1. **Enable Required Features in NetSuite:**
   - Navigate to `Setup > Company > Enable Features`
   - Under SuiteCloud subtab: Enable `REST WEB SERVICES` and `OAUTH 2.0`

2. **Create Integration Record:**
   - Go to `Setup > Integration > Manage Integrations > New`
   - Set State to `Enabled`
   - Under Authentication tab: Check `AUTHORIZATION CODE GRANT`
   - Set Redirect URI to: `{STACK_API_URL}/api/v1/auth/oauth/callback/netsuite`
   - Check `REST Web Services` under Scope

3. **Assign Permissions:**
   - Navigate to `Setup > Users/Roles > Manage Roles`
   - Add `REST Web Services` with Full access
   - Add `Log in using Access Tokens` with Full access

## Implementation Details

### OAuth Flow
1. **Authorization URL:** `https://{accountId}.app.netsuite.com/app/login/oauth2/authorize.nl`
2. **Token Endpoint:** `https://{accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`
3. **Scope:** `rest_webservices`
4. **User Info:** Retrieved via NetSuite REST API employee endpoints

### Key Features
- Supports NetSuite's OAuth 2.0 Authorization Code Grant flow
- Handles account-specific endpoints using NetSuite Account ID
- Implements user profile retrieval from NetSuite employee records
- Includes access token validation
- Follows Stack Auth's existing OAuth provider patterns

### Configuration Options
- `clientId` - OAuth Client ID from NetSuite Integration Record
- `clientSecret` - OAuth Client Secret from NetSuite Integration Record  
- `accountId` - NetSuite Account ID (can be provided via config or environment variable)

## Usage

The NetSuite OAuth provider can be configured in Stack Auth dashboard or via API:

```json
{
  "id": "netsuite",
  "type": "standard",
  "client_id": "your-netsuite-client-id",
  "client_secret": "your-netsuite-client-secret",
  "netsuite_account_id": "your-netsuite-account-id"
}
```

## Testing

The implementation has been tested for:
- ✅ TypeScript compilation
- ✅ Schema validation
- ✅ Integration with existing OAuth provider registry
- ✅ Backend build process

## Notes

- NetSuite access tokens typically expire in 1 hour
- NetSuite doesn't provide standard profile images via API
- User information is retrieved from NetSuite employee records
- Account ID is required and must be provided either via config or environment variable