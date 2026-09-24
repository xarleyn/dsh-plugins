import { describe, expect, it } from "vitest";
import { projectTranscript } from "../../src/admin/conversation-log.js";
import {
  defaultAdminRedactor,
  maskSecrets,
} from "../../src/admin/redaction.js";
describe("conversation log projection", () => {
  const events = [
    {
      seq: 0,
      type: "session/title",
      data: { title: "Release report" },
      time: 1_000,
    },
    {
      seq: 1,
      type: "user/message",
      data: {
        content: [{ type: "text", text: "Make the report" }],
        source: { kind: "user" },
      },
      time: 1_100,
    },
    {
      seq: 2,
      type: "user/message",
      data: {
        content: [{ type: "text", text: "injected skill body" }],
        source: { kind: "plugin", plugin: "skill" },
      },
      time: 1_150,
    },
    {
      seq: 3,
      type: "assistant/message",
      data: {
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking out loud" },
            { type: "text", text: "Here it is" },
          ],
          source: { kind: "model", provider: "zai", model: "glm-4.7" },
        },
        usage: { inputTokens: 120, outputTokens: 30 },
      },
      time: 1_200,
    },
    {
      seq: 4,
      type: "tool/call",
      data: {
        callId: "c1",
        name: "skill",
        arguments: '{"name":"release-notes"}',
      },
      time: 1_210,
    },
    {
      seq: 5,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: "skill loaded" }],
            },
          ],
        },
      },
      time: 1_240,
    },
    {
      seq: 6,
      type: "tool/call",
      data: {
        callId: "c2",
        name: "git_readonly",
        arguments: '{"repository":"api"}',
      },
      time: 1_250,
    },
    {
      seq: 7,
      type: "tool/result",
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: "c2",
              content: [{ type: "text", text: "command failed" }],
              isError: true,
            },
          ],
        },
        error: { name: "git", code: "E1" },
      },
      time: 1_300,
    },
  ];

  it("projects messages in log order, skipping injected context", () => {
    const project = projectTranscript(events, defaultAdminRedactor);
    expect(project.title).toBe("Release report");
    expect(project.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(project.messages[0]?.id).toBe("1");
    expect(project.lastActivity).toBe(1_300);
  });

  it("carries the assistant's model, usage and tool calls", () => {
    const project = projectTranscript(events, defaultAdminRedactor);
    const assistant = project.messages[1];
    expect(assistant?.model).toBe("glm-4.7");
    expect(assistant?.provider).toBe("zai");
    expect(assistant?.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(assistant?.text).toBe("Here it is");
    expect(assistant?.toolCalls?.map((call) => call.name)).toEqual([
      "skill",
      "git_readonly",
    ]);
    const [loaded, failed] = assistant?.toolCalls ?? [];
    expect(loaded?.result).toBe("skill loaded");
    expect(failed?.error).toBe("git");
    expect(failed?.durationMs).toBe(50);
  });

  it("reports the skills the model actually loaded", () => {
    const project = projectTranscript(events, defaultAdminRedactor);
    expect(project.loadedSkills).toEqual(["release-notes"]);
  });

  it("masks credential shapes in tool traffic", () => {
    expect(maskSecrets('{"apiKey":"sk-live-abcdef123456"}')).toBe(
      '{"apiKey":"[redacted]"}',
    );
    expect(maskSecrets("Authorization: Bearer abcdef1234567890")).toBe(
      "Authorization: [redacted]",
    );
    const project = projectTranscript(
      [
        {
          seq: 0,
          type: "tool/call",
          data: {
            callId: "c1",
            name: "http",
            arguments: '{"token":"secret-value-1234"}',
          },
        },
      ],
      defaultAdminRedactor,
    );
    expect(project.messages[0]?.toolCalls?.[0]?.arguments).not.toContain(
      "secret-value-1234",
    );
  });
});
