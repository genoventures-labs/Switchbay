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

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      paddingX={1}
    >
      <Text color="green" bold>
        Edit File
      </Text>
      <Text color="gray">Pick a file, then press Tab or Enter to move into edit intent.</Text>
      {files.length > 0 ? (
        files.map((file, index) => {
          const selected = index === selectedIndex;

          return (
            <Text key={file} color={selected ? "yellow" : "white"} bold={selected}>
              {selected ? ">" : " "} {file}
            </Text>
          );
        })
      ) : (
        <Text color="white">No matching files in the current workspace snapshot.</Text>
      )}
    </Box>
  );
}
