import React from "react";
import { Box, Text } from "ink";

type EditDrawerProps = {
  files: string[];
  selectedIndex: number;
  visible: boolean;
};

export function EditDrawer({ files, selectedIndex, visible }: EditDrawerProps) {
  if (!visible) {
    return null;
  }

  const brandColor = "#E57373";
  const greenColor = "#00FF7F";
  const grayColor = "#707070";

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      marginBottom={1}
      paddingX={2}
      borderStyle="round"
      borderColor={grayColor}
    >
      <Box marginBottom={1}>
        <Text color={brandColor} bold>Edit File</Text>
        <Text color={grayColor}> · Tab/Enter choose · Esc close</Text>
      </Box>
      {files.length > 0 ? (
        files.map((file, index) => {
          const selected = index === selectedIndex;

          return (
            <Box
              key={file}
              paddingX={1}
              backgroundColor={selected ? "#2D333B" : undefined}
            >
              <Text color={selected ? greenColor : grayColor} bold={selected}>
                {selected ? "❯" : " "}
              </Text>
              <Text color="white" bold={selected}>
                {" "}{file}
              </Text>
            </Box>
          );
        })
      ) : (
        <Text color={grayColor}>No matching files in the current workspace snapshot.</Text>
      )}
    </Box>
  );
}
