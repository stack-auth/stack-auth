#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import webbrowser
import requests
from typing import Dict, Optional, Any

class StackAuthCLI:
    def __init__(self, base_url: str = None):
        """Initialize the Stack Auth CLI client.
        
        Args:
            base_url: The base URL of the Stack Auth API. If not provided, 
                     it will try to read from STACK_AUTH_API_URL environment variable.
        """
        self.base_url = base_url or os.environ.get("STACK_AUTH_API_URL", "http://localhost:3000/api/latest")
        self.config_dir = os.path.expanduser("~/.stack-auth")
        self.config_file = os.path.join(self.config_dir, "config.json")
        self.refresh_token = None
        
        # Create config directory if it doesn't exist
        if not os.path.exists(self.config_dir):
            os.makedirs(self.config_dir)
        
        # Load config if it exists
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, "r") as f:
                    config = json.load(f)
                    self.refresh_token = config.get("refresh_token")
            except Exception as e:
                print(f"Error loading config: {e}")
    
    def save_config(self):
        """Save the current configuration to the config file."""
        config = {
            "refresh_token": self.refresh_token
        }
        
        try:
            with open(self.config_file, "w") as f:
                json.dump(config, f)
        except Exception as e:
            print(f"Error saving config: {e}")
    
    def login(self, tenancy_id: str):
        """Initiate the CLI authentication flow.
        
        Args:
            tenancy_id: The ID of the tenancy to authenticate with.
        """
        print("Initiating CLI authentication...")
        
        # Step 1: Call the initiate CLI auth endpoint
        response = self._initiate_cli_auth(tenancy_id)
        
        if not response:
            print("Failed to initiate CLI authentication.")
            return
        
        polling_code = response.get("polling_code")
        login_code = response.get("login_code")
        expires_at = response.get("expires_at")
        
        if not polling_code or not login_code:
            print("Invalid response from server.")
            return
        
        # Step 2: Open the browser for the user to authenticate
        auth_url = f"{self.base_url.replace('/api/latest', '')}/auth/cli?login_code={login_code}&tenancy_id={tenancy_id}"
        print(f"Opening browser to authenticate. If it doesn't open automatically, please visit:\n{auth_url}")
        webbrowser.open(auth_url)
        
        # Step 3: Poll the status endpoint until we get a success or error
        print("Waiting for authentication to complete...")
        refresh_token = self._poll_auth_status(tenancy_id, polling_code)
        
        if refresh_token:
            self.refresh_token = refresh_token
            self.save_config()
            print("Authentication successful! You are now logged in.")
        else:
            print("Authentication failed or timed out.")
    
    def _initiate_cli_auth(self, tenancy_id: str) -> Optional[Dict[str, Any]]:
        """Call the initiate CLI auth endpoint.
        
        Args:
            tenancy_id: The ID of the tenancy to authenticate with.
            
        Returns:
            The response from the server, or None if the request failed.
        """
        try:
            url = f"{self.base_url}/auth/cli"
            headers = {
                "Content-Type": "application/json",
                "X-Tenancy-ID": tenancy_id
            }
            data = {
                "expires_in_millis": 10 * 60 * 1000  # 10 minutes
            }
            
            response = requests.post(url, headers=headers, json=data)
            
            if response.status_code == 200:
                return response.json().get("body", {})
            else:
                print(f"Error initiating CLI auth: {response.status_code} {response.text}")
                return None
        except Exception as e:
            print(f"Error initiating CLI auth: {e}")
            return None
    
    def _poll_auth_status(self, tenancy_id: str, polling_code: str, max_attempts: int = 60) -> Optional[str]:
        """Poll the auth status endpoint until we get a success or error.
        
        Args:
            tenancy_id: The ID of the tenancy to authenticate with.
            polling_code: The polling code to use for checking auth status.
            max_attempts: Maximum number of polling attempts before timing out.
            
        Returns:
            The refresh token if authentication was successful, or None otherwise.
        """
        attempt = 0
        
        while attempt < max_attempts:
            try:
                url = f"{self.base_url}/auth/cli/poll"
                headers = {
                    "Content-Type": "application/json",
                    "X-Tenancy-ID": tenancy_id
                }
                data = {
                    "polling_code": polling_code
                }
                
                response = requests.post(url, headers=headers, json=data)
                
                if response.status_code == 200:
                    body = response.json().get("body", {})
                    status = body.get("status")
                    
                    if status == "success":
                        return body.get("refresh_token")
                    elif status == "waiting":
                        # Still waiting for the user to authenticate
                        pass
                    elif status == "expired":
                        print("Authentication request expired.")
                        return None
                    elif status == "used":
                        print("Authentication request already used.")
                        return None
                    else:
                        print(f"Unknown status: {status}")
                        return None
                else:
                    print(f"Error polling auth status: {response.status_code} {response.text}")
                    return None
            except Exception as e:
                print(f"Error polling auth status: {e}")
                return None
            
            # Wait 5 seconds before polling again
            time.sleep(5)
            attempt += 1
            sys.stdout.write(".")
            sys.stdout.flush()
        
        print("\nTimed out waiting for authentication.")
        return None

def main():
    parser = argparse.ArgumentParser(description="Stack Auth CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Login command
    login_parser = subparsers.add_parser("login", help="Log in to Stack Auth")
    login_parser.add_argument("--tenancy-id", required=True, help="The ID of the tenancy to authenticate with")
    login_parser.add_argument("--api-url", help="The base URL of the Stack Auth API")
    
    args = parser.parse_args()
    
    if args.command == "login":
        cli = StackAuthCLI(base_url=args.api_url)
        cli.login(args.tenancy_id)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
