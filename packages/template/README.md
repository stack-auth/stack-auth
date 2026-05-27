# Hexclave: Open-source Clerk/Auth0 alternative

## [📘 Docs](https://docs.hexclave.com) | [☁️ Hosted Version](https://hexclave.com/) | [✨ Demo](https://demo.hexclave.com/) | [🎮 Discord](https://discord.hexclave.com) | [GitHub](https://github.com/hexclave/hexclave)

Hexclave is a managed user authentication solution. It is developer-friendly and fully open-source (licensed under MIT and AGPL).

Hexclave gets you started in just five minutes, after which you'll be ready to use all of its features as you grow your project. Our managed service is completely optional and you can export your user data and self-host, for free, at any time.

We support Next.js frontends, along with any backend that can use our [REST API](https://docs.hexclave.com/rest-api/overview). Check out our [setup guide](https://docs.hexclave.com/getting-started/setup) to get started.

## 📦 Installation & Setup

1. Run Hexclave's installation wizard with the following command:
    ```bash
    npx @hexclave/cli@latest init
    ```
2. Then, create an account on the [Hexclave dashboard](https://app.hexclave.com/projects), create a new project with an API key, and copy its environment variables into the .env.local file of your Next.js project:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. That's it! You can run your app with `npm run dev` and go to [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) to see the sign-up page. You can also check out the account settings page at [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).


Check out the [documentation](https://docs.hexclave.com/getting-started/setup) for a more detailed guide.
