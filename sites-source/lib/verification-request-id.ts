// Rotate only the ID known to have failed. A newer ID may represent a request
// whose response was lost and must be reused until its outcome is known.
export function verificationRequestId(saved: string | null, latest: { status: string; requestId: string | null } | null, generate: () => string): string {
  if (!saved || (latest?.status === "Failed" && saved === latest.requestId)) return generate();
  return saved;
}
