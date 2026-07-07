import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { TUI_COLORS } from "../theme";

type EditIntentDrawerProps = {
  file: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  value: string;
  visible: boolean;
};

export function EditIntentDrawer({
  file,
  onChange,
  onSubmit,
  value,
  visible,
}: EditIntentDrawerProps) {
  if (!visible) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      paddingX={2}
      borderStyle="round"
      borderColor={TUI_COLORS.accentBright}
      backgroundColor={TUI_COLORS.baseDeep}
    >
      <Text color={TUI_COLORS.accentBright} bold>Edit Intent</Text>
      <Text color={TUI_COLORS.text}>Editing {file}</Text>
      <Text color={TUI_COLORS.muted}>Describe the change you want, then press Enter.</Text>
      <Box marginTop={1}>
        <Text color={TUI_COLORS.accentBright}>Intent: </Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
