import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { TUI_COLORS } from "../theme";

export type CreateSkillAnswers = {
  name: string;
  purpose: string;
  triggers: string;
  method: string;
  guardrails: string;
};

type Step = {
  key: keyof CreateSkillAnswers;
  question: string;
  hint: string;
  required: boolean;
};

const STEPS: Step[] = [
  { key: "name", question: "What should this skill be called?", hint: "e.g. Migration Review, Launch Checklist", required: true },
  { key: "purpose", question: "What repeatable method should it teach Bay?", hint: "Describe the workflow in normal words.", required: true },
  { key: "triggers", question: "When should this skill be used?", hint: "Optional. Words, situations, tasks, or user asks.", required: false },
  { key: "method", question: "Any must-follow steps or checklist?", hint: "Optional. Rough bullets are fine.", required: false },
  { key: "guardrails", question: "Any hard rules or risks?", hint: "Optional. What should Bay avoid or always flag?", required: false },
];

type CreateSkillDrawerProps = {
  generating: boolean;
  onCancel: () => void;
  onComplete: (answers: CreateSkillAnswers) => void;
  visible: boolean;
};

export function CreateSkillDrawer({ generating, onCancel, onComplete, visible }: CreateSkillDrawerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [current, setCurrent] = useState("");
  const [answers, setAnswers] = useState<CreateSkillAnswers>({
    name: "",
    purpose: "",
    triggers: "",
    method: "",
    guardrails: "",
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
          <Text color={brandColor} bold>Creating skill</Text>
          <Text color={grayColor}>Using the active lane to draft the markdown...</Text>
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
        <Text color={brandColor} bold>Create Skill</Text>
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
