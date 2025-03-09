# Stack Auth CLI

A command-line interface for Stack Auth that allows users to authenticate with the Stack Auth API.

## Installation

```bash
# Install from the local directory
pip install -e .
```

## Usage

### Login

To log in to Stack Auth, use the `login` command:

```bash
# Using the CLI directly
python stack_auth_cli.py login --tenancy-id YOUR_TENANCY_ID

# Or if installed via pip
stack-auth login --tenancy-id YOUR_TENANCY_ID
```

This will:
1. Initiate the CLI authentication process
2. Open your browser to complete the authentication
3. Poll the authentication status every 5 seconds
4. Save the refresh token to `~/.stack-auth/config.json` upon successful authentication

### Configuration

The CLI stores configuration in `~/.stack-auth/config.json`. This includes your refresh token after successful authentication.

### Environment Variables

- `STACK_AUTH_API_URL`: The base URL of the Stack Auth API. Defaults to `http://localhost:3000/api/latest`.

## Development

### Requirements

- Python 3.6+
- requests

### Testing

To test the CLI:

```bash
# Test the login command
python stack_auth_cli.py login --tenancy-id YOUR_TENANCY_ID
```
