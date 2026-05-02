import React from "react";
import { Box, Text } from "ink";
import type { ActivePlan } from "../../agent/turn-state";

type PlanPanelProps = {
  plan: ActivePlan;
};

export function PlanPanel({ plan }: PlanPanelProps) {
  const brandColor = "#E57373";
  const greenColor = "#00FF7F";
  const grayColor = "#707070";
  const dimColor = "#505050";

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
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box gap={2} marginBottom={1}>
        <Text color={brandColor} bold>📋 Plan</Text>
        <Text color="white">{plan.goal}</Text>
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
          let color = dimColor;
          if (isDone) { icon = "✓"; color = greenColor; }
          else if (isSkipped) { icon = "—"; color = grayColor; }
          else if (isCurrent) { icon = "▶"; color = brandColor; }

          return (
            <Box key={i} gap={1}>
              <Text color={color}>{icon}</Text>
              <Text color={isCurrent ? "white" : color} bold={isCurrent}>
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
          <Text color={greenColor}>y → execute</Text>
          <Text color="red">n → cancel</Text>
        </Box>
      )}
      {isContinue && (
        <Box marginTop={1} gap={3}>
          <Text color={greenColor}>y → continue</Text>
          <Text color={grayColor}>skip → skip step</Text>
          <Text color="red">stop → abort</Text>
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
