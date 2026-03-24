# Stack Auth Python SDK

Python SDK for [Stack Auth](https://stack-auth.com) - authentication, user management, and team management for your Python backend.

## Installation

```bash
pip install stack-auth
```

## Quick Start

```python
from stack_auth import StackServerApp

app = StackServerApp(
    project_id="your-project-id",
    secret_server_key="your-secret-key",
)

# Verify a request's access token
user = await app.authenticate_request(request)
```

## Requirements

- Python 3.10+
