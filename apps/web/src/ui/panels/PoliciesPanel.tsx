// Taxes, tariffs and price controls, realm-wide or per area (specification §6, Policies).
import { Section } from "../components";
import { PolicyEditor } from "./PolicyEditor";

export function PoliciesPanel() {
  return (
    <Section title="Taxes and price controls">
      <PolicyEditor />
    </Section>
  );
}
