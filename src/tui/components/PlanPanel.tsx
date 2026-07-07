import React from "react";
import { Box, Text } from "ink";
import type { ActivePlan } from "../../agent/turn-state";
import { TUI_COLORS } from "../theme";

type PlanPanelProps = {
  plan: ActivePlan;
};

export function PlanPanel({ plan }: PlanPanelProps) {
  const brandColor = TUI_COLORS.accentBright;
  const greenColor = TUI_COLORS.accent;
  const grayColor = TUI_COLORS.muted;
  const dimColor = TUI_COLORS.surfaceRaised;

  const isApproval = plan.status === "pending_approval";
  const isContinue = plan.status === "awaiting_continue";
  const isComplete = plan.status === "complete";
  const isStopped = plan.status === "stopped";

  const borderColor = isComplete ? greenColor : isStopped ? grayColor : brandColor;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={borderColor}
      backgroundColor={TUI_COLORS.baseDeep}
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box gap={2} marginBottom={1}>
        <Text color={brandColor} bold>Plan</Text>
        <Text color={TUI_COLORS.text}>{plan.goal}</Text>
        {isComplete && <Text color={greenColor} bold>· complete</Text>}
        {isStopped && <Text color={grayColor}>· stopped</Text>}
      </Box>

      {/* Steps */}
      <Box flexDirection="column">
        {plan.steps.map((step, i) => {
          const isDone = plan.completedSteps.includes(i);
          const isCurrent = i === plan.currentStep && !isComplete && !isStopped;
          const isSkipped = !isDone && i < plan.currentStep;
          const isPending = i > plan.currentStep && !isComplete;

          let icon = "○";
          let color: string = dimColor;
          if (isDone) { icon = "✓"; color = greenColor; }
          else if (isSkipped) { icon = "—"; color = grayColor; }
          else if (isCurrent) { icon = "▶"; color = brandColor; }

          return (
            <Box key={i} gap={1}>
              <Text color={color}>{icon}</Text>
              <Text color={isCurrent ? TUI_COLORS.text : color} bold={isCurrent}>
                {i + 1}. {step}
              </Text>
              {isCurrent && plan.status === "running" && (
                <Text color={brandColor} dimColor>running…</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Footer hint */}
      {isApproval && (
        <Box marginTop={1} gap={3}>
          <Text color={grayColor}>1 cancel</Text>
          <Text color={greenColor}>2 execute</Text>
        </Box>
      )}
      {isContinue && (
        <Box marginTop={1} gap={3}>
          <Text color={greenColor}>2 continue</Text>
          <Text color={grayColor}>skip → skip step</Text>
          <Text color={grayColor}>stop → abort</Text>
        </Box>
      )}
      {isComplete && (
        <Box marginTop={1}>
          <Text color={greenColor}>All {plan.steps.length} steps complete.</Text>
        </Box>
      )}
    </Box>
  );
}
