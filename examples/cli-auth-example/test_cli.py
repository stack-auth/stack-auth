#!/usr/bin/env python3
import unittest
from unittest.mock import patch, MagicMock
import json
import os
import tempfile
from stack_auth_cli import StackAuthCLI

class TestStackAuthCLI(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory for config
        self.temp_dir = tempfile.TemporaryDirectory()
        # Mock the config directory and file
        self.mock_config_dir = self.temp_dir.name
        self.mock_config_file = os.path.join(self.mock_config_dir, "config.json")
        
        # Create a CLI instance with mocked config paths
        self.cli = StackAuthCLI(base_url="http://localhost:3000/api/latest")
        self.cli.config_dir = self.mock_config_dir
        self.cli.config_file = self.mock_config_file
        
        # Test tenancy ID
        self.test_tenancy_id = "7eef59fd-72a0-47d7-a87d-eaec5ec5bb05"
    
    def tearDown(self):
        # Clean up the temporary directory
        self.temp_dir.cleanup()
    
    @patch('requests.post')
    @patch('webbrowser.open')
    def test_initiate_cli_auth(self, mock_webbrowser, mock_post):
        # Mock the response from the initiate CLI auth endpoint
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "body": {
                "polling_code": "test_polling_code",
                "login_code": "test_login_code",
                "expires_at": "2025-03-04T01:00:00Z"
            }
        }
        mock_post.return_value = mock_response
        
        # Call the method
        result = self.cli._initiate_cli_auth(self.test_tenancy_id)
        
        # Verify the result
        self.assertEqual(result["polling_code"], "test_polling_code")
        self.assertEqual(result["login_code"], "test_login_code")
        self.assertEqual(result["expires_at"], "2025-03-04T01:00:00Z")
        
        # Verify the request
        mock_post.assert_called_once_with(
            "http://localhost:3000/api/latest/auth/cli",
            headers={
                "Content-Type": "application/json",
                "X-Tenancy-ID": self.test_tenancy_id
            },
            json={"expires_in_millis": 10 * 60 * 1000}
        )
    
    @patch('requests.post')
    def test_poll_auth_status_waiting(self, mock_post):
        # Mock the response from the poll endpoint - waiting status
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "body": {
                "status": "waiting"
            }
        }
        mock_post.return_value = mock_response
        
        # Patch time.sleep to avoid waiting
        with patch('time.sleep'):
            # Set max_attempts to 2 to speed up the test
            self.cli._poll_auth_status(self.test_tenancy_id, "test_polling_code", max_attempts=2)
            
            # Verify the request
            mock_post.assert_called_with(
                "http://localhost:3000/api/latest/auth/cli/poll",
                headers={
                    "Content-Type": "application/json",
                    "X-Tenancy-ID": self.test_tenancy_id
                },
                json={"polling_code": "test_polling_code"}
            )
            
            # Verify it was called twice (for max_attempts=2)
            self.assertEqual(mock_post.call_count, 2)
    
    @patch('requests.post')
    def test_poll_auth_status_success(self, mock_post):
        # Mock the response from the poll endpoint - success status
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "body": {
                "status": "success",
                "refresh_token": "test_refresh_token"
            }
        }
        mock_post.return_value = mock_response
        
        # Call the method
        refresh_token = self.cli._poll_auth_status(self.test_tenancy_id, "test_polling_code")
        
        # Verify the result
        self.assertEqual(refresh_token, "test_refresh_token")
        
        # Verify the request
        mock_post.assert_called_once_with(
            "http://localhost:3000/api/latest/auth/cli/poll",
            headers={
                "Content-Type": "application/json",
                "X-Tenancy-ID": self.test_tenancy_id
            },
            json={"polling_code": "test_polling_code"}
        )
    
    @patch('requests.post')
    def test_poll_auth_status_expired(self, mock_post):
        # Mock the response from the poll endpoint - expired status
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "body": {
                "status": "expired"
            }
        }
        mock_post.return_value = mock_response
        
        # Call the method
        refresh_token = self.cli._poll_auth_status(self.test_tenancy_id, "test_polling_code")
        
        # Verify the result
        self.assertIsNone(refresh_token)
        
        # Verify the request
        mock_post.assert_called_once_with(
            "http://localhost:3000/api/latest/auth/cli/poll",
            headers={
                "Content-Type": "application/json",
                "X-Tenancy-ID": self.test_tenancy_id
            },
            json={"polling_code": "test_polling_code"}
        )
    
    @patch('requests.post')
    def test_poll_auth_status_used(self, mock_post):
        # Mock the response from the poll endpoint - used status
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "body": {
                "status": "used"
            }
        }
        mock_post.return_value = mock_response
        
        # Call the method
        refresh_token = self.cli._poll_auth_status(self.test_tenancy_id, "test_polling_code")
        
        # Verify the result
        self.assertIsNone(refresh_token)
        
        # Verify the request
        mock_post.assert_called_once_with(
            "http://localhost:3000/api/latest/auth/cli/poll",
            headers={
                "Content-Type": "application/json",
                "X-Tenancy-ID": self.test_tenancy_id
            },
            json={"polling_code": "test_polling_code"}
        )
    
    @patch('requests.post')
    def test_poll_auth_status_error(self, mock_post):
        # Mock an error response
        mock_post.side_effect = Exception("Connection error")
        
        # Call the method
        refresh_token = self.cli._poll_auth_status(self.test_tenancy_id, "test_polling_code")
        
        # Verify the result
        self.assertIsNone(refresh_token)
    
    @patch.object(StackAuthCLI, '_initiate_cli_auth')
    @patch.object(StackAuthCLI, '_poll_auth_status')
    @patch('webbrowser.open')
    def test_login_success(self, mock_webbrowser, mock_poll, mock_initiate):
        # Mock the initiate CLI auth response
        mock_initiate.return_value = {
            "polling_code": "test_polling_code",
            "login_code": "test_login_code",
            "expires_at": "2025-03-04T01:00:00Z"
        }
        
        # Mock the poll auth status response
        mock_poll.return_value = "test_refresh_token"
        
        # Call the login method
        self.cli.login(self.test_tenancy_id)
        
        # Verify the refresh token was saved
        self.assertEqual(self.cli.refresh_token, "test_refresh_token")
        
        # Verify the config file was created
        self.assertTrue(os.path.exists(self.mock_config_file))
        
        # Verify the config file contains the refresh token
        with open(self.mock_config_file, "r") as f:
            config = json.load(f)
            self.assertEqual(config["refresh_token"], "test_refresh_token")
        
        # Verify the browser was opened with the correct URL
        mock_webbrowser.assert_called_once_with(
            "http://localhost:3000/auth/cli?login_code=test_login_code&tenancy_id=7eef59fd-72a0-47d7-a87d-eaec5ec5bb05"
        )
    
    @patch.object(StackAuthCLI, '_initiate_cli_auth')
    def test_login_initiate_failure(self, mock_initiate):
        # Mock the initiate CLI auth response to fail
        mock_initiate.return_value = None
        
        # Call the login method
        self.cli.login(self.test_tenancy_id)
        
        # Verify the refresh token was not set
        self.assertIsNone(self.cli.refresh_token)
        
        # Verify the config file was not created
        self.assertFalse(os.path.exists(self.mock_config_file))

if __name__ == "__main__":
    unittest.main()
