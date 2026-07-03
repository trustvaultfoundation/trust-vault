// Run an Arweave GraphQL query directly against a gateway (these endpoints send
// Access-Control-Allow-Origin: *). No server proxy, so the app can be served as a
// fully static bundle from Arweave/ArNS. Only public on-chain metadata flows through
// here — never document data or keys. A failed/CORS-less gateway 5xx is caught and
// returned as null; callers union the results with the other gateway.
export async function gqlQuery<N = unknown>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: { transactions?: { edges?: { node: N }[] } } } | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
