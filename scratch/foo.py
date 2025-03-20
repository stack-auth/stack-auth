import time
import requests
import webbrowser
import urllib.parse

def prompt_cli_login(
  *,
  base_url: str = "http://localhost:8102",
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

if __name__ == '__main__':
  # Should not work, this points to the internal project
  prompt_cli_login(
    app_url='http://localhost:8101',
    project_id='5b3a5da8-6455-40de-8147-a9142ce65cc8',
    publishable_client_key='pck_ry8719r52pf1mnxncmjck2vk6c4bv77qgw12z9ajvy45g',
  )

  # # Should work, this points to the internal project
  # prompt_cli_login(
  #   app_url='http://myapp.example.com',
  #   project_id='internal',
  #   publishable_client_key='pck_fx5pjn4gn60wan42dxjsc6tn73sav938a7b28kyj29mqr',
  # )
