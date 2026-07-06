export interface AcceptanceResult {
  id:       string;
  name:     string;
  passed:   boolean;
  details?: string;
}

export type AcceptanceFn = () => Promise<AcceptanceResult>;

export const acceptanceTests: { id: string; name: string; run: AcceptanceFn }[] = [];

export function registerAcceptance(id: string, name: string, run: AcceptanceFn): void {
  if (acceptanceTests.some((t) => t.id === id)) {
    throw new Error(`acceptance check ${id} already registered`);
  }
  acceptanceTests.push({ id, name, run });
}

export async function runAllAcceptance(): Promise<AcceptanceResult[]> {
  const out: AcceptanceResult[] = [];
  for (const t of acceptanceTests) {
    out.push(await t.run());
  }
  return out;
}
