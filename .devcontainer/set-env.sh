#!/bin/bash

if [ -n "$CODESPACE_NAME" ]; then
    export NEXT_PUBLIC_STACK_API_URL="https://${CODESPACE_NAME}-8102.app.github.dev"
    export STACK_MOCK_OAUTH_REDIRECT_URIS="https://${CODESPACE_NAME}-8102.app.github.dev/api/v1/auth/oauth/callback/{id}"
    export NEXT_PUBLIC_STACK_DASHBOARD_URL="https://${CODESPACE_NAME}-8101.app.github.dev"
    gh codespace ports visibility 8102:public -c $CODESPACE_NAME && gh codespace ports visibility 8114:public -c $CODESPACE_NAME
fi 

echo 'To start the development server with dependencies, run: pnpm restart-deps && pnpm dev'
