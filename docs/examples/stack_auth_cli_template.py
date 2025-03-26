import time
import requests
import webbrowser
import urllib.parse

def prompt_cli_login(
  *,
  base_url: str = "https://api.stack-auth.com",
  app_url: str,
  project_id: str,
  publishable_client_key: str,
):
  if not app_url:
    raise Exception("app_url is required and must be set to the URL of the app you're authenticating with")
  if not project_id:
    raise Exception("project_id is required")
  if not publishable_client_key:
    raise Exception("publishable_client_key is required")

  def post(endpoint, json):
    return requests.request(
      'POST',
      f'{base_url}{endpoint}',
      headers={
        'Content-Type': 'application/json',
        'x-stack-project-id': project_id,
        'x-stack-access-type': 'client',
        'x-stack-publishable-client-key': publishable_client_key,
      },
      json=json,
    )

  # Step 1: Initiate the CLI auth process
  init = post('/api/v1/auth/cli', {
    'expires_in_millis': 10 * 60 * 1000,
  })
  if init.status_code != 200:
    raise Exception(f"Failed to initiate CLI auth: {init.status_code} {init.text}")
  polling_code = init.json()['polling_code']
  login_code = init.json()['login_code']

  # Step 2: Open the browser for the user to authenticate
  url = f'{app_url}/handler/cli-auth-confirm?login_code={urllib.parse.quote(login_code)}'
  print(f"Opening browser to authenticate. If it doesn't open automatically, please visit:\n{url}")
  webbrowser.open(url)

  # Step 3: Retrieve the token
  while True:
    status = post('/api/v1/auth/cli/poll', {
      'polling_code': polling_code,
    })
    if status.status_code != 200 and status.status_code != 201:
      raise Exception(f"Failed to get CLI auth status: {status.status_code} {status.text}")
    if status.json()['status'] == 'success':
      return status.json()['refresh_token']
    time.sleep(2)
