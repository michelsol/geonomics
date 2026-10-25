// Taxes, tariffs and price controls, realm-wide or per area, and standing orders (specification §6). The map shows
// real net income.
import { Section } from "../components";
import { PolicyEditor } from "./PolicyEditor";
import { StandingOrders } from "./StandingOrders";

export function PoliciesPanel() {
  return (
    <>
      <Section title="Taxes and price controls">
        <PolicyEditor />
      </Section>
      <StandingOrders />
    </>
  );
}
