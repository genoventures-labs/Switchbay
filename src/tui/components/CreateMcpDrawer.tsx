import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { TUI_COLORS } from "../theme";

export type CreateMcpAnswers = {
  name: string;
  purpose: string;
  servers: string;
  integrations: string;
  notes: string;
};

type Step = {
  key: keyof CreateMcpAnswers;
  question: string;
  hint: string;
  required: boolean;
};

const STEPS: Step[] = [
  { key: "name", question: "What should this MCP lane config be called?", hint: "e.g. Local Browser Tools, Studio Research Rig", required: true },
  { key: "purpose", question: "What should LM Studio MCP help Bay do?", hint: "Describe the local/tool workflow.", required: true },
  { key: "servers", question: "Which trusted MCP servers should it use?", hint: "Catalog: playwright, filesystem, github, memory, fetch, sequential-thinking, postgres.", required: true },
  { key: "integrations", question: "Exact catalog integration IDs if you know them?", hint: "Optional. Example: mcp/playwright, mcp/filesystem. Unknown ids are rejected.", required: false },
  { key: "notes", question: "Any host, model, allowed-tools, or setup notes?", hint: "Optional. Mention your LM Studio host/IP or auth requirement.", required: false },
];

type CreateMcpDrawerProps = {
  generating: boolean;
  onCancel: () => void;
  onComplete: (answers: CreateMcpAnswers) => void;
  visible: boolean;
};

export function CreateMcpDrawer({ generating, onComplete, visible }: CreateMcpDrawerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [current, setCurrent] = useState("");
  const [answers, setAnswers] = useState<CreateMcpAnswers>({
    name: "",
    purpose: "",
    servers: "",
    integrations: "",
    notes: "",
  });

  if (!visible) return null;

  const step = STEPS[stepIndex] ?? STEPS[0]!;
  const brandColor = TUI_COLORS.accentBright;
  const grayColor = TUI_COLORS.muted;
  const greenColor = TUI_COLORS.accent;

  if (generating) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} marginBottom={1} borderStyle="round" borderColor={brandColor} backgroundColor={TUI_COLORS.baseDeep}>
        <Box gap={2}>
          <Text color={brandColor} bold>Creating MCP config</Text>
          <Text color={grayColor}>Selecting from the trusted MCP catalog...</Text>
        </Box>
      </Box>
    );
  }

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed && step.required) return;
    const updated = { ...answers, [step.key]: trimmed };
    setAnswers(updated);
    setCurrent("");
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((index) => index + 1);
    } else {
      onComplete(updated);
    }
  };

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} marginBottom={1} borderStyle="round" borderColor={brandColor} backgroundColor={TUI_COLORS.baseDeep}>
      <Box gap={2} marginBottom={1}>
        <Text color={brandColor} bold>Create MCP Config</Text>
        <Text color={grayColor}>step {stepIndex + 1}/{STEPS.length}</Text>
        <Text color={grayColor}>· Esc to cancel</Text>
      </Box>

      <Box gap={1} marginBottom={1}>
        {STEPS.map((s, i) => (
          <Text key={s.key} color={i < stepIndex ? greenColor : i === stepIndex ? brandColor : grayColor}>
            {i <= stepIndex ? "●" : "○"}
          </Text>
        ))}
      </Box>

      <Text color={TUI_COLORS.text} bold>{step.question}</Text>
      <Text color={grayColor}>{step.hint}</Text>

      {stepIndex > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {STEPS.slice(0, stepIndex).map((s) => (
            answers[s.key] ? (
              <Box key={s.key} gap={1}>
                <Text color={grayColor}>✓</Text>
                <Text color={grayColor}>{s.key}:</Text>
                <Text color={grayColor} dimColor>{answers[s.key].slice(0, 60)}{answers[s.key].length > 60 ? "..." : ""}</Text>
              </Box>
            ) : null
          ))}
        </Box>
      )}

      <Box marginTop={1} gap={1}>
        <Text color={brandColor}>›</Text>
        <TextInput
          value={current}
          onChange={setCurrent}
          onSubmit={handleSubmit}
          placeholder={step.required ? "required" : "optional - Enter to skip"}
        />
      </Box>
    </Box>
  );
}
