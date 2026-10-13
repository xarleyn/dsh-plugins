// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceOperationPolicyField } from "../../src/client/operator-sections/service-operation-policy.js";
import { SERVICE_POLICY_OPERATIONS } from "../../src/service-credentials/catalog.js";

describe("shared service profile operation editor", () => {
  it("allows a build log while preserving existing section prohibitions", () => {
    const onChange = vi.fn();
    render(
      <ServiceOperationPolicyField
        provider="teamcity"
        operations={SERVICE_POLICY_OPERATIONS.teamcity ?? []}
        entries={[["artifacts.read", "deny"]]}
        disabled={false}
        testId="policy-test"
        onChange={onChange}
      />,
    );
    const control = screen.getByLabelText("Читать лог сборки (builds.log)");
    fireEvent.change(control, { target: { value: "allow" } });
    expect(onChange).toHaveBeenCalledWith([
      ["artifacts.read", "deny"],
      ["builds.log", "allow"],
    ]);
  });
  it("displays a stored allowance and removes it back to the default", () => {
    const onChange = vi.fn();
    render(
      <ServiceOperationPolicyField
        provider="gitlab"
        operations={SERVICE_POLICY_OPERATIONS.gitlab ?? []}
        entries={[["jobs.log", "allow"]]}
        disabled={false}
        testId="policy-test"
        onChange={onChange}
      />,
    );
    const control = screen.getByLabelText(/\(jobs.log\)/u) as HTMLSelectElement;
    expect(control.value).toBe("allow");
    fireEvent.change(control, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("disables all edits when the host form is read-only", () => {
    render(
      <ServiceOperationPolicyField
        provider="jira"
        operations={SERVICE_POLICY_OPERATIONS.jira ?? []}
        entries={[["issues.read", "deny"]]}
        disabled={true}
        testId="policy-test"
        onChange={vi.fn()}
      />,
    );
    expect(
      screen
        .getAllByRole("combobox", { hidden: true })
        .every((x) => (x as HTMLSelectElement).disabled),
    ).toBe(true);
  });
});
