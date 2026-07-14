import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { TUI_COLORS } from "../theme";

export type CreateRuleAnswers = {
  name: string;
  trigger: string;
  rule: string;
  appliesTo: string;
  scope: string;
};

type Step = {
  key: keyof CreateRuleAnswers;
  question: string;
  hint: string;
  required: boolean;
};

const STEPS: Step[] = [
  { key: "name", question: "What should this rule be called?", hint: "e.g. Spreadsheet Edits, MCP Browser Safety", required: true },
  { key: "trigger", question: "When should models read this rule?", hint: "Comma-separated triggers, e.g. spreadsheet, csv, sheet edits", required: true },
  { key: "rule", question: "What should models always do or never do?", hint: "Plain language is fine. This becomes the rule body.", required: true },
  { key: "appliesTo", question: "What tasks or tools does this apply to?", hint: "Optional. Describe the lane, tool, agent, or workflow.", required: false },
  { key: "scope", question: "Save globally or just this workspace?", hint: "Type global or workspace. Default: global.", required: false },
];

type CreateRuleDrawerProps = {
  generating: boolean;
  onCancel: () => void;
  onComplete: (answers: CreateRuleAnswers) => void;
  visible: boolean;
};

export function CreateRuleDrawer({ generating, onComplete, visible }: CreateRuleDrawerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [current, setCurrent] = useState("");
  const [answers, setAnswers] = useState<CreateRuleAnswers>({
    name: "",
    trigger: "",
    rule: "",
    appliesTo: "",
    scope: "",
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
          <Text color={brandColor} bold>Creating rule</Text>
          <Text color={grayColor}>Writing the guide markdown...</Text>
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
      onComplete({
        ...updated,
        scope: updated.scope.trim() || "global",
      });
    }
  };

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} marginBottom={1} borderStyle="round" borderColor={brandColor} backgroundColor={TUI_COLORS.baseDeep}>
      <Box gap={2} marginBottom={1}>
        <Text color={brandColor} bold>Create Rule</Text>
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
