import { createServer } from "vite";

async function main() {
  const server = await createServer({
    server: { port: 0, strictPort: false },
    logLevel: "error",
    // Skip dependency pre-bundling: this check only fetches raw text (never
    // executes the module), so bare imports don't need to resolve. Running
    // the optimizer here also races its background completion against our
    // early server.close()/process.exit(), which intermittently trips
    // Node's "unsettled top-level await" diagnostic on a cold cache.
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  try {
    await server.listen();

    const url = server.resolvedUrls?.local?.[0];
    if (!url) {
      throw new Error("smoke: dev server did not report a local URL");
    }

    const rootRes = await fetch(url);
    if (rootRes.status !== 200) {
      throw new Error(`smoke: GET / returned status ${rootRes.status}`);
    }
    const rootBody = await rootRes.text();
    if (!rootBody.includes('id="root"')) {
      throw new Error('smoke: response body for / does not contain id="root"');
    }

    const mainRes = await fetch(new URL("/src/main.tsx", url));
    if (mainRes.status !== 200) {
      throw new Error(`smoke: GET /src/main.tsx returned status ${mainRes.status}`);
    }
    const mainBody = await mainRes.text();
    if (!mainBody.includes("App")) {
      throw new Error("smoke: transformed /src/main.tsx does not reference App");
    }

    console.log(`smoke: ok ${url}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

await main();
process.exit(process.exitCode ?? 0);
