// Lightweight step helper for Jest tests
// Usage: await step('Given I do X', async () => { ... })
export async function step(title, fn) {
  // eslint-disable-next-line no-console
  console.log(`STEP: ${title}`);
  return await fn();
}
