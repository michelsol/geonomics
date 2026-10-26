// Taxes, tariffs and price controls, realm-wide or per area, and standing orders (specification §5). The map shows
// real net income.
import { PolicyEditor } from "./PolicyEditor";
import { StandingOrders } from "./StandingOrders";

export function PoliciesPanel() {
  return (
    <>
      <PolicyEditor />
      <StandingOrders />
    </>
  );
}
