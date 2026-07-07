import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { TUI_COLORS } from "../theme";

export type CreateEngineAnswers = {
  name: string;
  purpose: string;
  tools: string;
  commands: string;
  approval: string;
};

type Step = {
  key: keyof CreateEngineAnswers;
  question: string;
  hint: string;
  required: boolean;
};

const STEPS: Step[] = [
  {
    key: "name",
    question: "What should this engine be called?",
    hint: "e.g. File Helper, Gumroad Ops, Release Rig",
    required: true,
  },
  {
    key: "purpose",
    question: "What should this engine help Bay do?",
    hint: "Describe the workflow or internal tool surface.",
    required: true,
  },
  {
    key: "tools",
    question: "What tools should it expose?",
    hint: "List actions like search files, summarize folder, run report.",
    required: true,
  },
  {
    key: "commands",
    question: "Known commands, scripts, paths, or APIs?",
    hint: "Optional. Example: python scripts/report.py --path {{path}}",
    required: false,
  },
  {
    key: "approval",
    question: "Anything risky that should always ask first?",
    hint: "Optional. Mention deletes, publishes, refunds, writes outside repo.",
    required: false,
  },
];

type CreateEngineDrawerProps = {
  generating: boolean;
  onCancel: () => void;
  onComplete: (answers: CreateEngineAnswers) => void;
  visible: boolean;
};

export function CreateEngineDrawer({
  generating,
  onCancel,
  onComplete,
  visible,
}: CreateEngineDrawerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [current, setCurrent] = useState("");
  const [answers, setAnswers] = useState<CreateEngineAnswers>({
    name: "",
    purpose: "",
    tools: "",
    commands: "",
    approval: "",
  });

  if (!visible) return null;

  const step = STEPS[stepIndex] ?? STEPS[0]!;
  const brandColor = TUI_COLORS.accentBright;
  const grayColor = TUI_COLORS.muted;
  const greenColor = TUI_COLORS.accent;

  if (generating) {
    return (
      <Box
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        marginBottom={1}
        borderStyle="round"
        borderColor={brandColor}
        backgroundColor={TUI_COLORS.baseDeep}
      >
        <Box gap={2}>
          <Text color={brandColor} bold>Creating engine</Text>
          <Text color={grayColor}>Using the Cloud lane to draft the manifest...</Text>
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
      setStepIndex((i) => i + 1);
    } else {
      onComplete(updated);
    }
  };

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={brandColor}
      backgroundColor={TUI_COLORS.baseDeep}
    >
      <Box gap={2} marginBottom={1}>
        <Text color={brandColor} bold>Create Engine</Text>
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
