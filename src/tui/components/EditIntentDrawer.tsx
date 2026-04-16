import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

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
      borderColor="magenta"
    >
      <Text color="magenta" bold>Edit Intent</Text>
      <Text color="white">Editing {file}</Text>
      <Text color="gray" dimColor>Describe the change you want ORI to make, then press Enter.</Text>
      <Box marginTop={1}>
        <Text color="magenta">Intent: </Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
