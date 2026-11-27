const DEFAULT_AUTH_ATTEMPTS_PER_MINUTE = 10;

// Read per request: decorators are evaluated before ConfigModule loads .env.
export function authAttemptsPerMinute(): number {
  const parsed = Number(process.env.AUTH_THROTTLE_LIMIT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AUTH_ATTEMPTS_PER_MINUTE;
}

export const AUTH_THROTTLE = {
  default: { limit: () => authAttemptsPerMinute(), ttl: 60_000 },
};
