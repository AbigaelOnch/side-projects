// Runs once when the server starts: begins the twice-a-day checks of followed organisations.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOrgChecks } = await import("./lib/orgs");
    startOrgChecks();
  }
}
