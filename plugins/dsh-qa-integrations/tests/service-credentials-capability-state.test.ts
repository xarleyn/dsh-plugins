import { operationCapabilityServiceState } from "../src/service-credentials/state.js";
import type { CapabilityServiceState } from "../src/types.js";
import { OPERATIONS } from "./service-credentials.helpers.js";
describe("managed service credentials: capability state", () => {
  it("is available, sensitive or unavailable per capability", () => {
    const table = Object.fromEntries(
      Object.entries(OPERATIONS).filter(
        ([operation]) => operation !== "records.unclassified",
      ),
    );
    expect(operationCapabilityServiceState(table, "records.read")).toBe(
      "available" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "logs.read")).toBe(
      "sensitive" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "records.write")).toBe(
      "unavailable" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "identity.read")).toBe(
      "available" satisfies CapabilityServiceState,
    );
    expect(operationCapabilityServiceState(table, "nothing.read")).toBe(
      "unavailable" satisfies CapabilityServiceState,
    );
  });
});
