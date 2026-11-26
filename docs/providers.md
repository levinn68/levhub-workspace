# Configuring multiple providers (backend)

The deploy-time `createConfiguredRegistry` factory keeps 9Router as `9router` and adds OpenAI-compatible providers from the backend environment. Configure only provider endpoints you trust with your chat data. URLs are administrative deployment settings, not user-supplied request fields. Do not put credentials in URLs or commit them to Git.

Example backend environment (replace example values in your hosting control panel):

```dotenv
LEVHUB_CUSTOM_PROVIDERS='[{"id":"custom","name":"Custom provider","baseUrl":"https://api.example.com/v1","apiKeyEnv":"LEVHUB_PROVIDER_CUSTOM_KEY","discover":false,"modelIds":["my-model"]}]'
LEVHUB_PROVIDER_CUSTOM_KEY=replace-in-hosting-secret-manager
```

When `discover` is true (the default), the adapter calls `/models`; optionally supplied manual IDs are still included. Chat calls use `/chat/completions`. Native Anthropic and Gemini APIs need their own adapters; an OpenAI-compatible endpoint can use the custom adapter.

The factory is not yet called by the web server. The existing chat routes, Settings, usage dashboard and UI remain unchanged. To integrate Panel Discussion, validate every selected provider-qualified ID against the server-side catalog, then pass `registry.complete` into `runPanelDiscussion`.
