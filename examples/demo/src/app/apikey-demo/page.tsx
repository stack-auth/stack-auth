"use client";

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, Input, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

export default function ApiKeyDemo() {
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<{ user: { user: any, error: string | null }, team: { team: any, error: string | null }, api_keys: { api_keys: any, error: string | null } } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch("/apikey-demo/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        user: { user: null, error: error.message },
        team: { team: null, error: error.message },
        api_keys: { api_keys: null, error: error.message }
      });
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="stack-scope min-h-screen flex items-center justify-center p-4 w-full">
      <Card className="w-full p-6 ">
        <Typography variant="primary" className="mb-6 text-center">
          API Key Validator
        </Typography>

        <form onSubmit={(e) => { runAsynchronouslyWithAlert(handleSubmit(e)); }} className="space-y-4">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium  mb-1">
              Enter your API Key
            </label>
            <Input
              id="apiKey"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key here"
              className="w-full"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading || !apiKey}
            className="w-full"
          >
            {isLoading ? "Validating..." : "Validate Key"}
          </Button>
        </form>

        {result && (
          <div className="mt-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* User Information */}
              <div className={`p-4 rounded-md flex-1 ${
                result.user.user ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"
              }`}>
                <Typography variant="secondary" className="font-medium mb-2 dark:text-white">
                  User Information
                </Typography>
                {result.user.user ? (
                  <div className="text-green-700 dark:text-green-400">
                    <p>✅ Valid user API key</p>
                    <pre className="mt-2 text-xs overflow-auto p-2 bg-green-100 dark:bg-green-900/40 rounded">
                      {JSON.stringify(result.user.user, null, 2)}
                    </pre>
                    <Typography variant="secondary" className="font-medium mb-2 dark:text-white">
                      API Keys
                    </Typography>
                    <pre className="mt-2 text-xs overflow-auto p-2 bg-green-100 dark:bg-green-900/40 rounded">
                      {JSON.stringify(result.api_keys, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-red-700 dark:text-red-400">
                    <p>❌ Invalid user API key</p>
                    {result.user.error && (
                      <p className="text-sm mt-1">{result.user.error}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Team Information */}
              <div className={`p-4 rounded-md flex-1 ${
                result.team.team ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"
              }`}>
                <Typography variant="secondary" className="font-medium mb-2 dark:text-white">
                  Team Information
                </Typography>
                {result.team.team ? (
                  <div className="text-green-700 dark:text-green-400">
                    <p>✅ Valid team API key</p>
                    <pre className="mt-2 text-xs overflow-auto p-2 bg-green-100 dark:bg-green-900/40 rounded">
                      {JSON.stringify(result.team.team, null, 2)}

                    </pre>
                    <Typography variant="secondary" className="font-medium mb-2 dark:text-white">
                      API Keys
                    </Typography>
                    <pre className="mt-2 text-xs overflow-auto p-2 bg-green-100 dark:bg-green-900/40 rounded">
                      {JSON.stringify(result.api_keys, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-red-700 dark:text-red-400">
                    <p>❌ Invalid team API key</p>
                    {result.team.error && (
                      <p className="text-sm mt-1">{result.team.error}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
