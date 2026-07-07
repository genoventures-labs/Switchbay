import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { TUI_COLORS } from "../theme";

export type CreateAgentAnswers = {
  name: string;
  specialty: string;
  approach: string;
  rules: string;
};

type Step = {
  key: keyof CreateAgentAnswers;
  question: string;
  hint: string;
  required: boolean;
};

const STEPS: Step[] = [
  {
    key: "name",
    question: "What should we call this agent?",
    hint: "e.g. React Native Expert, SQL Tutor, API Designer",
    required: true,
  },
  {
    key: "specialty",
    question: "What's its core expertise?",
    hint: "What tasks should it dominate? What does it know deeply?",
    required: true,
  },
  {
    key: "approach",
    question: "How should it communicate and approach problems?",
    hint: "Style, tone, methodology — press Enter to skip",
    required: false,
  },
  {
    key: "rules",
    question: "Hard rules — what must it always flag or never do?",
    hint: "Non-negotiable behaviors — press Enter to skip",
    required: false,
  },
];

type CreateAgentDrawerProps = {
  visible: boolean;
  generating: boolean;
  onComplete: (answers: CreateAgentAnswers) => void;
  onCancel: () => void;
};

export function CreateAgentDrawer({
  visible,
  generating,
  onComplete,
  onCancel,
}: CreateAgentDrawerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [current, setCurrent] = useState("");
  const [answers, setAnswers] = useState<CreateAgentAnswers>({
    name: "",
    specialty: "",
    approach: "",
    rules: "",
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
          <Text color={brandColor} bold>Creating agent</Text>
          <Text color={grayColor}>Writing the definition…</Text>
        </Box>
      </Box>
    );
  }

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed && step.required) return; // don't advance if required and empty

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
      {/* Header */}
      <Box gap={2} marginBottom={1}>
        <Text color={brandColor} bold>Create Agent</Text>
        <Text color={grayColor}>
          step {stepIndex + 1}/{STEPS.length}
        </Text>
        <Text color={grayColor}>· Esc to cancel</Text>
      </Box>

      {/* Progress dots */}
      <Box gap={1} marginBottom={1}>
        {STEPS.map((s, i) => (
          <Text key={s.key} color={i < stepIndex ? greenColor : i === stepIndex ? brandColor : grayColor}>
            {i < stepIndex ? "●" : i === stepIndex ? "●" : "○"}
          </Text>
        ))}
      </Box>

      {/* Question */}
      <Text color={TUI_COLORS.text} bold>{step.question}</Text>
      <Text color={grayColor}>{step.hint}</Text>

      {/* Already answered summary */}
      {stepIndex > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {STEPS.slice(0, stepIndex).map((s) => (
            answers[s.key] ? (
              <Box key={s.key} gap={1}>
                <Text color={grayColor}>✓</Text>
                <Text color={grayColor}>{s.key}:</Text>
                <Text color={grayColor} dimColor>{answers[s.key].slice(0, 60)}{answers[s.key].length > 60 ? "…" : ""}</Text>
              </Box>
            ) : null
          ))}
        </Box>
      )}

      {/* Input */}
      <Box marginTop={1} gap={1}>
        <Text color={brandColor}>›</Text>
        <TextInput
          value={current}
          onChange={setCurrent}
          onSubmit={handleSubmit}
          placeholder={step.required ? "required" : "optional — Enter to skip"}
        />
      </Box>
    </Box>
  );
}
