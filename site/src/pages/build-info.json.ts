export function GET() {
  const tz = (import.meta.env.SITE_TIMEZONE as string | undefined) || "America/Los_Angeles";
  const built = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  });
  return new Response(JSON.stringify({ built }), {
    headers: { "Content-Type": "application/json" },
  });
}
